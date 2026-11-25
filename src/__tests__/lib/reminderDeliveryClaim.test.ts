import {
  claimReminderDelivery,
  markReminderSent,
  releaseReminderClaim,
  _clearSentInMemory,
} from "@/lib/reminderCron";

describe("Atomic Reminder Delivery Claim Pipeline", () => {
  beforeEach(() => {
    _clearSentInMemory();
    jest.clearAllMocks();
  });

  describe("In-Memory Fallback Atomic Claims", () => {
    it("claims an unclaimed reminder successfully", async () => {
      const result = await claimReminderDelivery("test:reminder:1", 300, null);
      expect(result.claimed).toBe(true);
      expect(typeof result.claimToken).toBe("string");
      expect(result.claimToken).toHaveLength(36);
    });

    it("prevents concurrent workers from claiming the same reminder key", async () => {
      const worker1 = await claimReminderDelivery(
        "test:reminder:concurrent",
        300,
        null,
      );
      const worker2 = await claimReminderDelivery(
        "test:reminder:concurrent",
        300,
        null,
      );
      const worker3 = await claimReminderDelivery(
        "test:reminder:concurrent",
        300,
        null,
      );

      expect(worker1.claimed).toBe(true);
      expect(worker2.claimed).toBe(false);
      expect(worker3.claimed).toBe(false);
    });

    it("allows a retry when a failed delivery releases its claim", async () => {
      const claim1 = await claimReminderDelivery(
        "test:reminder:retry",
        300,
        null,
      );
      expect(claim1.claimed).toBe(true);

      // Worker encounters delivery failure and releases claim
      await releaseReminderClaim(
        "test:reminder:retry",
        claim1.claimToken!,
        null,
      );

      // Subsequent retry by worker 2 should successfully claim
      const claim2 = await claimReminderDelivery(
        "test:reminder:retry",
        300,
        null,
      );
      expect(claim2.claimed).toBe(true);
      expect(claim2.claimToken).not.toBe(claim1.claimToken);
    });

    it("does not release claim when called with a mismatched token", async () => {
      const claim = await claimReminderDelivery(
        "test:reminder:tamper",
        300,
        null,
      );
      expect(claim.claimed).toBe(true);

      // Attempt release with unauthorized token
      await releaseReminderClaim(
        "test:reminder:tamper",
        "wrong-token-12345",
        null,
      );

      // Key should still be claimed
      const attempt = await claimReminderDelivery(
        "test:reminder:tamper",
        300,
        null,
      );
      expect(attempt.claimed).toBe(false);
    });

    it("prevents re-claiming after a reminder is marked as successfully sent", async () => {
      const claim = await claimReminderDelivery(
        "test:reminder:success",
        300,
        null,
      );
      expect(claim.claimed).toBe(true);

      // Delivery succeeds
      await markReminderSent(
        "test:reminder:success",
        claim.claimToken!,
        7200,
        null,
      );

      // Subsequent sweep should NOT claim
      const sweep = await claimReminderDelivery(
        "test:reminder:success",
        300,
        null,
      );
      expect(sweep.claimed).toBe(false);
    });
  });

  describe("Redis Distributed Atomic Claims", () => {
    it("delegates to Redis SET NX EX atomically", async () => {
      const mockStorage = new Map<string, string>();
      const mockRedis: any = {
        set: jest.fn(
          async (
            key: string,
            value: string,
            options?: { nx?: boolean; ex?: number },
          ) => {
            if (options?.nx && mockStorage.has(key)) {
              return null;
            }
            mockStorage.set(key, value);
            return "OK";
          },
        ),
        get: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
        del: jest.fn(async (key: string) => {
          mockStorage.delete(key);
          return 1;
        }),
      };

      // Worker 1 claims
      const w1 = await claimReminderDelivery("booking:123", 300, mockRedis);
      expect(w1.claimed).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "booking:123",
        `claimed:${w1.claimToken}`,
        { nx: true, ex: 300 },
      );

      // Worker 2 attempts same key concurrently -> rejected
      const w2 = await claimReminderDelivery("booking:123", 300, mockRedis);
      expect(w2.claimed).toBe(false);

      // Worker 1 commits success with 2-hour TTL
      await markReminderSent("booking:123", w1.claimToken!, 7200, mockRedis);
      expect(mockRedis.set).toHaveBeenCalledWith("booking:123", "sent", {
        ex: 7200,
      });

      // Next sweep cannot claim
      const w3 = await claimReminderDelivery("booking:123", 300, mockRedis);
      expect(w3.claimed).toBe(false);
    });

    it("releases Redis claim on failed delivery allowing another worker to retry", async () => {
      const mockStorage = new Map<string, string>();
      const mockRedis: any = {
        set: jest.fn(
          async (
            key: string,
            value: string,
            options?: { nx?: boolean; ex?: number },
          ) => {
            if (options?.nx && mockStorage.has(key)) {
              return null;
            }
            mockStorage.set(key, value);
            return "OK";
          },
        ),
        get: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
        del: jest.fn(async (key: string) => {
          mockStorage.delete(key);
          return 1;
        }),
      };

      const w1 = await claimReminderDelivery("session:456:u1", 300, mockRedis);
      expect(w1.claimed).toBe(true);

      // Network error during send -> release claim
      await releaseReminderClaim("session:456:u1", w1.claimToken!, mockRedis);
      expect(mockRedis.del).toHaveBeenCalledWith("session:456:u1");

      // Retry worker successfully claims
      const retry = await claimReminderDelivery(
        "session:456:u1",
        300,
        mockRedis,
      );
      expect(retry.claimed).toBe(true);
    });
  });
});
