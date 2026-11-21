import {
  signWebhookPayload,
  verifyWebhookSignature,
  getRetryDelayMs,
  isRetriableFailure,
  moveToDeadLetterQueue,
  getDeadLetterQueueEntries,
  dispatchWebhookWithRetries,
  replayDeadLetterQueueEntry,
  resetInMemoryDLQ,
  RETRY_INTERVALS_MS,
  MAX_RETRY_ATTEMPTS,
} from "@/lib/webhooks/webhookDispatcher";

// Mock prisma
jest.mock("@/lib/prisma", () => ({
  prisma: {
    webhookDeliveryLog: {
      create: jest.fn().mockResolvedValue({ id: "log-1" }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

describe("Webhook Dispatcher Engine", () => {
  const testSecret = "whsec_test_secret_key_123456";
  const testPayload = {
    event: "booking.confirmed",
    bookingId: "bkg_abc123",
    venueId: "venue_alpha",
    amount: 45.0,
  };

  beforeEach(() => {
    resetInMemoryDLQ();
    jest.clearAllMocks();
  });

  describe("HMAC-SHA256 Signing and Verification", () => {
    it("signs payload using HMAC-SHA256 in required header format", () => {
      const fixedTimestamp = 1700000000;
      const result = signWebhookPayload(testPayload, testSecret, fixedTimestamp);

      expect(result.timestamp).toBe(fixedTimestamp);
      expect(result.signature).toMatch(/^[0-9a-f]{64}$/); // 64-char hex string
      expect(result.header).toBe(`t=${fixedTimestamp},v1=${result.signature}`);
    });

    it("verifies a valid signature successfully", () => {
      const fixedTimestamp = 1700000000;
      const signed = signWebhookPayload(testPayload, testSecret, fixedTimestamp);

      const verification = verifyWebhookSignature(
        testPayload,
        signed.header,
        testSecret,
        { toleranceSeconds: 0 }, // disable timestamp expiration for test
      );

      expect(verification.isValid).toBe(true);
      expect(verification.timestamp).toBe(fixedTimestamp);
    });

    it("rejects an altered payload (tampering detection)", () => {
      const signed = signWebhookPayload(testPayload, testSecret);
      const tamperedPayload = { ...testPayload, amount: 999.0 };

      const verification = verifyWebhookSignature(
        tamperedPayload,
        signed.header,
        testSecret,
      );

      expect(verification.isValid).toBe(false);
      expect(verification.reason).toBe("SIGNATURE_MISMATCH");
    });

    it("rejects expired timestamps exceeding tolerance window", () => {
      const pastTimestamp = 1700000000;
      const currentTimestamp = 1700000500; // 500s later (tolerance is 300s)

      const signed = signWebhookPayload(testPayload, testSecret, pastTimestamp);

      const verification = verifyWebhookSignature(
        testPayload,
        signed.header,
        testSecret,
        { toleranceSeconds: 300, currentTimestamp },
      );

      expect(verification.isValid).toBe(false);
      expect(verification.reason).toBe("TIMESTAMP_OUT_OF_TOLERANCE");
    });

    it("rejects malformed signature headers", () => {
      expect(verifyWebhookSignature(testPayload, null, testSecret).isValid).toBe(false);
      expect(verifyWebhookSignature(testPayload, "", testSecret).isValid).toBe(false);
      expect(verifyWebhookSignature(testPayload, "invalid_header", testSecret).isValid).toBe(false);
    });
  });

  describe("Exponential Backoff Retry Policy", () => {
    it("enforces exact intervals: 1m, 5m, 30m, 2h, 24h", () => {
      expect(RETRY_INTERVALS_MS).toHaveLength(5);
      expect(MAX_RETRY_ATTEMPTS).toBe(5);

      expect(getRetryDelayMs(1)).toBe(60_000); // 1 minute
      expect(getRetryDelayMs(2)).toBe(300_000); // 5 minutes
      expect(getRetryDelayMs(3)).toBe(1_800_000); // 30 minutes
      expect(getRetryDelayMs(4)).toBe(7_200_000); // 2 hours
      expect(getRetryDelayMs(5)).toBe(86_400_000); // 24 hours

      // Beyond 5 attempts returns null
      expect(getRetryDelayMs(6)).toBeNull();
      expect(getRetryDelayMs(0)).toBeNull();
    });

    it("classifies retriable vs non-retriable failures", () => {
      // 5xx and network errors are retriable
      expect(isRetriableFailure(500, false)).toBe(true);
      expect(isRetriableFailure(502, false)).toBe(true);
      expect(isRetriableFailure(503, false)).toBe(true);
      expect(isRetriableFailure(504, false)).toBe(true);
      expect(isRetriableFailure(null, true)).toBe(true); // Network timeout

      // 429 rate limit is retriable
      expect(isRetriableFailure(429, false)).toBe(true);

      // 4xx client errors are permanent and non-retriable
      expect(isRetriableFailure(400, false)).toBe(false);
      expect(isRetriableFailure(401, false)).toBe(false);
      expect(isRetriableFailure(403, false)).toBe(false);
      expect(isRetriableFailure(404, false)).toBe(false);
      expect(isRetriableFailure(422, false)).toBe(false);
    });
  });

  describe("Dead Letter Queue (DLQ) & Dispatching", () => {
    it("delivers successfully on first attempt when endpoint returns 200", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        text: jest.fn().mockResolvedValue('{"status":"received"}'),
      });

      const result = await dispatchWebhookWithRetries({
        endpointUrl: "https://example.com/webhook",
        secret: testSecret,
        eventType: "booking.confirmed",
        payload: testPayload,
        fetchFn: mockFetch as any,
      });

      expect(result.success).toBe(true);
      expect(result.attemptNumber).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.movedToDlq).toBeUndefined();
    });

    it("aborts without retry on non-retriable 4xx client errors", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 400,
        statusText: "Bad Request",
        text: jest.fn().mockResolvedValue("Invalid payload schema"),
      });

      const result = await dispatchWebhookWithRetries({
        endpointUrl: "https://example.com/webhook",
        secret: testSecret,
        eventType: "booking.confirmed",
        payload: testPayload,
        fetchFn: mockFetch as any,
      });

      expect(result.success).toBe(false);
      expect(result.attemptNumber).toBe(1);
      expect(result.isRetriable).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.movedToDlq).toBeUndefined();
    });

    it("retries up to 5 times and moves to Dead Letter Queue (DLQ) upon exhaustion", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 503,
        statusText: "Service Unavailable",
        text: jest.fn().mockResolvedValue("Server overloaded"),
      });

      const retryAttempts: number[] = [];
      const onRetry = jest.fn((attempt, delayMs) => {
        retryAttempts.push(attempt);
      });

      const result = await dispatchWebhookWithRetries(
        {
          endpointId: "ep_123",
          endpointUrl: "https://failing-receiver.com/hook",
          secret: testSecret,
          eventType: "booking.confirmed",
          payload: testPayload,
          fetchFn: mockFetch as any,
        },
        onRetry,
      );

      // Should have attempted 5 times
      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(onRetry).toHaveBeenCalledTimes(4); // 4 retries after attempt 1
      expect(result.success).toBe(false);
      expect(result.movedToDlq).toBe(true);
      expect(result.dlqId).toBeDefined();

      // Check DLQ entries
      const dlqEntries = await getDeadLetterQueueEntries();
      expect(dlqEntries.length).toBeGreaterThan(0);
      const entry = dlqEntries.find((e) => e.id === result.dlqId);
      expect(entry).toBeDefined();
      expect(entry?.eventType).toBe("booking.confirmed");
      expect(entry?.failedAttempts).toBe(5);
      expect(entry?.requiresManualReview).toBe(true);
    });

    it("allows manual review and replay of a DLQ entry", async () => {
      const dlqId = await moveToDeadLetterQueue({
        endpointId: "ep_test",
        endpointUrl: "https://repaired-endpoint.com/webhook",
        eventType: "booking.confirmed",
        payload: testPayload,
        failedAttempts: 5,
        lastStatusCode: 500,
        lastError: "Initial 5 retries failed",
      });

      // Mock successful endpoint response on replay
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: jest.fn().mockResolvedValue("OK"),
      });

      try {
        const replayResult = await replayDeadLetterQueueEntry(dlqId, testSecret);
        expect(replayResult?.success).toBe(true);

        // After successful replay, removed from in-memory DLQ
        const dlqEntries = await getDeadLetterQueueEntries();
        expect(dlqEntries.find((e) => e.id === dlqId)).toBeUndefined();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
