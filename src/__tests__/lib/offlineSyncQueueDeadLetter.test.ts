import {
  calculateBackoff,
  isPermanentClientError,
  OfflineSyncQueueManager,
  SyncError,
} from "@/lib/offlineSyncQueue";

describe("Offline Sync Queue Dead-Letter & Resiliency", () => {
  describe("Exponential Backoff Calculation", () => {
    it("calculates exponential backoff with predictable jitter factor", () => {
      const config = {
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitterFactor: 0.5,
      };

      // With randomFn returning 0, backoff should be pure base * 2^attempt
      const zeroJitter = () => 0;
      expect(calculateBackoff(0, config, zeroJitter)).toBe(1000);
      expect(calculateBackoff(1, config, zeroJitter)).toBe(2000);
      expect(calculateBackoff(2, config, zeroJitter)).toBe(4000);
      expect(calculateBackoff(3, config, zeroJitter)).toBe(8000);
      expect(calculateBackoff(4, config, zeroJitter)).toBe(16000);
      expect(calculateBackoff(5, config, zeroJitter)).toBe(30000); // Capped at maxDelayMs

      // With randomFn returning 1, backoff includes full jitter addition
      const fullJitter = () => 1;
      expect(calculateBackoff(0, config, fullJitter)).toBe(1500); // 1000 + 500
      expect(calculateBackoff(1, config, fullJitter)).toBe(3000); // 2000 + 1000
      expect(calculateBackoff(2, config, fullJitter)).toBe(6000); // 4000 + 2000
    });
  });

  describe("Permanent Error Classification", () => {
    it("identifies HTTP 400 and 422 errors as permanent", () => {
      expect(isPermanentClientError(new SyncError("Bad request", 400))).toBe(true);
      expect(isPermanentClientError(new SyncError("Unprocessable entity", 422))).toBe(true);
      expect(isPermanentClientError({ status: 404 })).toBe(true);
      expect(isPermanentClientError({ statusCode: 403 })).toBe(true);
      expect(isPermanentClientError(new Error("Validation error on venue review"))).toBe(true);
    });

    it("identifies 5xx and network drop errors as transient (not permanent)", () => {
      expect(isPermanentClientError(new SyncError("Internal server error", 500))).toBe(false);
      expect(isPermanentClientError(new SyncError("Service unavailable", 503))).toBe(false);
      expect(isPermanentClientError(new SyncError("Rate limited", 429))).toBe(false);
      expect(isPermanentClientError(new SyncError("Timeout", 408))).toBe(false);
      expect(isPermanentClientError(new Error("Network connection dropped"))).toBe(false);
    });
  });

  describe("Dead-Letter Escalation & Recovery", () => {
    it("immediately escalates unrecoverable client errors (400/422) to dead_letter", async () => {
      const queue = new OfflineSyncQueueManager({ maxRetries: 5 });

      queue.enqueue("booking:create", { venueId: "v-1", date: "2026-10-06" }, { id: "item-1" });

      await queue.process(async () => {
        throw new SyncError("Invalid booking parameters", 400);
      });

      const item = queue.getItem("item-1");
      expect(item).toBeDefined();
      expect(item?.status).toBe("dead_letter");
      expect(item?.failureReason).toBe("unrecoverable_client_error");
      expect(item?.attempts).toBe(1); // Escalated immediately without wasting all 5 retries
    });

    it("retries transient 500 errors until maxRetries is exceeded before escalating to dead_letter", async () => {
      const queue = new OfflineSyncQueueManager({ maxRetries: 3, baseDelayMs: 0 });

      queue.enqueue("review:submit", { venueId: "v-2", rating: 5 }, { id: "item-2" });

      // First attempt fails with 500 -> status should be retry
      await queue.process(async () => {
        throw new SyncError("Database temporary failure", 500);
      });

      let item = queue.getItem("item-2");
      expect(item?.status).toBe("retry");
      expect(item?.attempts).toBe(1);

      // Force next attempt time to now and process second time
      item!.nextAttemptAt = Date.now() - 1000;
      await queue.process(async () => {
        throw new SyncError("Database temporary failure", 500);
      });
      expect(item?.attempts).toBe(2);
      expect(item?.status).toBe("retry");

      // Force third attempt -> reaches maxRetries (3) -> escalates to dead_letter
      item!.nextAttemptAt = Date.now() - 1000;
      await queue.process(async () => {
        throw new SyncError("Database temporary failure", 500);
      });
      expect(item?.attempts).toBe(3);
      expect(item?.status).toBe("dead_letter");
      expect(item?.failureReason).toBe("max_retries_exceeded");
    });

    it("allows dead-letter items to be reset and re-queued for retry", async () => {
      const queue = new OfflineSyncQueueManager({ maxRetries: 3 });

      queue.enqueue("favorite:toggle", { venueId: "v-3" }, { id: "item-3" });
      await queue.process(async () => {
        throw new SyncError("Validation error", 422);
      });

      expect(queue.getItem("item-3")?.status).toBe("dead_letter");

      const retriedCount = queue.retryDeadLetter("item-3");
      expect(retriedCount).toBe(1);

      const item = queue.getItem("item-3");
      expect(item?.status).toBe("pending");
      expect(item?.attempts).toBe(0);
      expect(item?.failureReason).toBeUndefined();
    });
  });

  describe("Queue Storage Quota Validation", () => {
    it("throws an error when maxQueueSize limit is exceeded during enqueue", () => {
      const queue = new OfflineSyncQueueManager({ maxQueueSize: 2 });

      queue.enqueue("action:1", { data: 1 }, { id: "q-1" });
      queue.enqueue("action:2", { data: 2 }, { id: "q-2" });

      expect(() => {
        queue.enqueue("action:3", { data: 3 }, { id: "q-3" });
      }).toThrow(/Sync queue capacity exceeded: max 2 items/);
    });
  });
});
