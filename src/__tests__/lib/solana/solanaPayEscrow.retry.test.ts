import {
  solanaPayEscrowManager,
  reserveSeatOptimistically,
  isSolanaRpcRateLimitError,
  parseRetryAfterMs,
  computeRpc429Delay,
  resetSeatReservations,
  DEFAULT_RPC_429_MAX_RETRIES,
  DEFAULT_RPC_429_BASE_DELAY_MS,
  DEFAULT_RPC_429_MAX_DELAY_MS,
} from "@/lib/solana/solanaPayEscrow";
import type { Connection, SignatureStatus } from "@solana/web3.js";

const SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJklSzLj699";

describe("Solana RPC 429 Handling with Exponential Jitter Backoff (#9510)", () => {
  let mockConnection: Partial<Connection>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetSeatReservations();
    mockConnection = {
      onSignatureWithOptions: jest.fn(),
      removeSignatureListener: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    resetSeatReservations();
  });

  describe("isSolanaRpcRateLimitError", () => {
    it("detects numeric status / statusCode / code 429", () => {
      expect(isSolanaRpcRateLimitError({ status: 429 })).toBe(true);
      expect(isSolanaRpcRateLimitError({ statusCode: 429 })).toBe(true);
      expect(isSolanaRpcRateLimitError({ code: 429 })).toBe(true);
      expect(isSolanaRpcRateLimitError({ response: { status: 429 } })).toBe(true);
      expect(isSolanaRpcRateLimitError({ response: { statusCode: 429 } })).toBe(true);
    });

    it("detects string status 429 and rate limit error names", () => {
      expect(isSolanaRpcRateLimitError({ status: "429" })).toBe(true);
      expect(isSolanaRpcRateLimitError({ name: "RateLimitError" })).toBe(true);
      expect(isSolanaRpcRateLimitError({ name: "TooManyRequestsError" })).toBe(true);
    });

    it("detects rate-limit messages from Solana nodes and providers", () => {
      expect(isSolanaRpcRateLimitError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
      expect(isSolanaRpcRateLimitError(new Error("Rate limit exceeded for endpoint"))).toBe(true);
      expect(isSolanaRpcRateLimitError(new Error("Resource exhausted: quota exceeded"))).toBe(true);
      expect(isSolanaRpcRateLimitError("Too Many Requests")).toBe(true);
    });

    it("does not detect unrelated errors as 429", () => {
      expect(isSolanaRpcRateLimitError(null)).toBe(false);
      expect(isSolanaRpcRateLimitError(undefined)).toBe(false);
      expect(isSolanaRpcRateLimitError(new Error("Blockhash not found"))).toBe(false);
      expect(isSolanaRpcRateLimitError({ status: 500 })).toBe(false);
      expect(isSolanaRpcRateLimitError({ status: 400 })).toBe(false);
      expect(isSolanaRpcRateLimitError(new Error("Transaction simulation failed"))).toBe(false);
    });
  });

  describe("parseRetryAfterMs", () => {
    it("parses integer delta-seconds", () => {
      expect(parseRetryAfterMs({ headers: { "retry-after": "5" } })).toBe(5000);
      expect(parseRetryAfterMs({ headers: { "Retry-After": "3" } })).toBe(3000);
    });

    it("parses floating delta-seconds", () => {
      expect(parseRetryAfterMs({ headers: { "retry-after": "2.5" } })).toBe(2500);
    });

    it("parses Headers object getter", () => {
      const headers = new Map();
      headers.set("retry-after", "4");
      expect(parseRetryAfterMs({ headers })).toBe(4000);
    });

    it("parses HTTP-date format", () => {
      const baseNow = 1_700_000_000_000;
      const futureDate = new Date(baseNow + 7_000).toUTCString();
      expect(parseRetryAfterMs({ headers: { "Retry-After": futureDate } }, baseNow)).toBe(7000);
    });

    it("returns undefined for missing or invalid header", () => {
      expect(parseRetryAfterMs({})).toBeUndefined();
      expect(parseRetryAfterMs({ headers: {} })).toBeUndefined();
      expect(parseRetryAfterMs({ headers: { "retry-after": "invalid-date" } })).toBeUndefined();
      expect(parseRetryAfterMs(null)).toBeUndefined();
    });
  });

  describe("computeRpc429Delay", () => {
    it("respects base delay, exponential growth, and max delay cap", () => {
      // With fixed random factor 1.0 (maximum delay of each attempt)
      const maxRandom = () => 1.0;

      // attempt 0: baseDelay * 2^0 = 500
      expect(computeRpc429Delay(0, { randomFn: maxRandom })).toBe(500);
      // attempt 1: baseDelay * 2^1 = 1000
      expect(computeRpc429Delay(1, { randomFn: maxRandom })).toBe(1000);
      // attempt 2: baseDelay * 2^2 = 2000
      expect(computeRpc429Delay(2, { randomFn: maxRandom })).toBe(2000);
      // attempt 3: baseDelay * 2^3 = 4000
      expect(computeRpc429Delay(3, { randomFn: maxRandom })).toBe(4000);
      // attempt 4: baseDelay * 2^4 = 8000 (capped at max 8000)
      expect(computeRpc429Delay(4, { randomFn: maxRandom })).toBe(8000);
      // attempt 5: capped at maxDelay 8000
      expect(computeRpc429Delay(5, { randomFn: maxRandom })).toBe(8000);
    });

    it("applies full jitter between 0 and exponential cap", () => {
      const halfRandom = () => 0.5;
      expect(computeRpc429Delay(0, { randomFn: halfRandom })).toBe(250);
      expect(computeRpc429Delay(1, { randomFn: halfRandom })).toBe(500);
      expect(computeRpc429Delay(2, { randomFn: halfRandom })).toBe(1000);
    });
  });

  describe("SolanaPayEscrow polling retry flow with HTTP 429", () => {
    it("retries a 429 response with jittered backoff and succeeds on subsequent confirmation", async () => {
      const error429 = { status: 429, message: "Too Many Requests" };
      const successStatus: SignatureStatus = {
        slot: 100,
        confirmations: null,
        err: null,
        confirmationStatus: "finalized",
      };

      const pollSignatureStatus = jest
        .fn()
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce(successStatus);

      const onStateChange = jest.fn();
      const onFinalized = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-1",
        venueId: "venue-1",
        signature: SIGNATURE,
        payerWallet: "wallet-1",
        amount: 10,
        confirmationMode: "polling",
        pollIntervalMs: 2000,
        pollSignatureStatus,
        rpc429RetryOptions: {
          randomFn: () => 1.0, // predictable delay: attempt 0 = 500ms
        },
        callbacks: { onStateChange, onFinalized },
      });

      // Initial poll fires at pollIntervalMs (2000ms)
      await jest.advanceTimersByTimeAsync(2000);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1);

      // It got 429, should schedule retry at 500ms (not normal 2000ms)
      await jest.advanceTimersByTimeAsync(499);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(2);

      // Verify finalized callback was called
      expect(onFinalized).toHaveBeenCalledWith(
        expect.objectContaining({
          state: "finalized",
          paymentStatus: "finalized",
          seatId: "seat-1",
        }),
      );
    });

    it("respects server Retry-After header during 429 backoff", async () => {
      const error429WithHeader = {
        status: 429,
        headers: { "Retry-After": "3" }, // 3 seconds = 3000ms
        message: "Too Many Requests",
      };

      const successStatus: SignatureStatus = {
        slot: 105,
        confirmations: null,
        err: null,
        confirmationStatus: "finalized",
      };

      const pollSignatureStatus = jest
        .fn()
        .mockRejectedValueOnce(error429WithHeader)
        .mockResolvedValueOnce(successStatus);

      const onFinalized = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-2",
        venueId: "venue-1",
        signature: SIGNATURE,
        payerWallet: "wallet-1",
        amount: 10,
        confirmationMode: "polling",
        pollIntervalMs: 2000,
        pollSignatureStatus,
        callbacks: { onFinalized },
      });

      // Advance to initial poll at 2000ms
      await jest.advanceTimersByTimeAsync(2000);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1);

      // Should wait exactly 3000ms because of Retry-After
      await jest.advanceTimersByTimeAsync(2999);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(2);
      expect(onFinalized).toHaveBeenCalled();
    });

    it("rolls back when maximum 429 retries are exhausted", async () => {
      const error429 = { status: 429, message: "Too Many Requests" };
      const pollSignatureStatus = jest.fn().mockRejectedValue(error429);
      const onRollback = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-3",
        venueId: "venue-1",
        signature: SIGNATURE,
        payerWallet: "wallet-1",
        amount: 10,
        confirmationMode: "polling",
        pollIntervalMs: 1000,
        pollSignatureStatus,
        rpc429RetryOptions: {
          maxRetries: 3,
          baseDelayMs: 200,
          randomFn: () => 1.0, // 200ms, 400ms, 800ms
        },
        callbacks: { onRollback },
      });

      // Initial poll at 1000ms (attempt 0 fails -> retry in 200ms)
      await jest.advanceTimersByTimeAsync(1000);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1);

      // Retry 1 at 200ms (attempt 1 fails -> retry in 400ms)
      await jest.advanceTimersByTimeAsync(200);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(2);

      // Retry 2 at 400ms (attempt 2 fails -> retry in 800ms)
      await jest.advanceTimersByTimeAsync(400);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(3);

      // Retry 3 at 800ms (attempt 3 exceeds maxRetries 3 -> fails)
      await jest.advanceTimersByTimeAsync(800);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(4);

      // Rolled back due to exhausted retries
      expect(onRollback).toHaveBeenCalledWith(
        expect.stringContaining("Solana RPC rate limit exceeded (3 retries exhausted)"),
        expect.objectContaining({ state: "available", paymentStatus: "failed" }),
      );
    });

    it("does not apply 429 retry policy to non-429 errors (uses normal polling interval)", async () => {
      const networkError = new Error("General socket error");
      const pollSignatureStatus = jest.fn().mockRejectedValueOnce(networkError);

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-4",
        venueId: "venue-1",
        signature: SIGNATURE,
        payerWallet: "wallet-1",
        amount: 10,
        confirmationMode: "polling",
        pollIntervalMs: 2000,
        pollSignatureStatus,
      });

      // Initial poll at 2000ms
      await jest.advanceTimersByTimeAsync(2000);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1);

      // Non-429 error retries after the standard pollIntervalMs (2000ms), NOT 500ms
      await jest.advanceTimersByTimeAsync(500);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1500);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(2);
    });

    it("terminates when confirmation timeout occurs while waiting for retry delay", async () => {
      const error429 = {
        status: 429,
        headers: { "Retry-After": "40" }, // 40 seconds delay
      };

      const pollSignatureStatus = jest.fn().mockRejectedValue(error429);
      const onRollback = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-5",
        venueId: "venue-1",
        signature: SIGNATURE,
        payerWallet: "wallet-1",
        amount: 10,
        timeoutMs: 10000, // 10 seconds total confirmation timeout
        confirmationMode: "polling",
        pollIntervalMs: 2000,
        pollSignatureStatus,
        callbacks: { onRollback },
      });

      // At 2000ms initial poll runs, remaining timeout is 8000ms.
      // Retry-After asks for 40,000ms, which exceeds remaining 8,000ms!
      await jest.advanceTimersByTimeAsync(2000);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1);

      // Should immediately rollback due to timeout rather than sleeping beyond deadline
      expect(onRollback).toHaveBeenCalledWith(
        expect.stringContaining("Transaction confirmation timed out while waiting for rate-limit backoff"),
        expect.objectContaining({ state: "available", paymentStatus: "timeout" }),
      );
    });

    it("cancels further retries if reservation is rolled back or aborted", async () => {
      const error429 = { status: 429, message: "Too Many Requests" };
      const pollSignatureStatus = jest.fn().mockRejectedValue(error429);

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-6",
        venueId: "venue-1",
        signature: SIGNATURE,
        payerWallet: "wallet-1",
        amount: 10,
        confirmationMode: "polling",
        pollIntervalMs: 2000,
        pollSignatureStatus,
        rpc429RetryOptions: {
          baseDelayMs: 1000,
          randomFn: () => 1.0,
        },
      });

      // First poll at 2000ms -> fails with 429 -> schedules retry in 1000ms
      await jest.advanceTimersByTimeAsync(2000);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1);

      // Caller cancels / rolls back before the retry timer fires
      solanaPayEscrowManager.rollback("seat-6", "User cancelled reservation");

      // Advance time past the scheduled retry
      await jest.advanceTimersByTimeAsync(5000);
      expect(pollSignatureStatus).toHaveBeenCalledTimes(1); // No further calls
    });
  });
});
