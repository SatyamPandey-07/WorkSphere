import {
  OfflineSyncQueueManager,
  calculateBackoff,
  createOfflineSyncQueue,
  globalSyncQueue,
  DEFAULT_QUEUE_CONFIG,
  SyncQueueEvent,
} from "@/lib/offlineSyncQueue";

describe("offlineSyncQueue", () => {
  describe("calculateBackoff", () => {
    it("returns base delay when attempt is 0 and jitter is 0", () => {
      const delay = calculateBackoff(0, { baseDelayMs: 1000 }, () => 0);
      expect(delay).toBe(1000);
    });

    it("doubles delay exponentially with attempts", () => {
      const delay1 = calculateBackoff(1, { baseDelayMs: 1000 }, () => 0);
      const delay2 = calculateBackoff(2, { baseDelayMs: 1000 }, () => 0);
      const delay3 = calculateBackoff(3, { baseDelayMs: 1000 }, () => 0);

      expect(delay1).toBe(2000);
      expect(delay2).toBe(4000);
      expect(delay3).toBe(8000);
    });

    it("caps delay at maxDelayMs", () => {
      const delay = calculateBackoff(
        10,
        { baseDelayMs: 1000, maxDelayMs: 15000 },
        () => 0,
      );
      expect(delay).toBe(15000);
    });

    it("adds proportional jitter based on jitterFactor and randomFn", () => {
      const delay = calculateBackoff(
        2,
        { baseDelayMs: 1000, maxDelayMs: 30000, jitterFactor: 0.5 },
        () => 0.5,
      );
      // rawBackoff = 4000; jitter = 4000 * 0.5 * 0.5 = 1000; total = 5000
      expect(delay).toBe(5000);
    });
  });

  describe("OfflineSyncQueueManager enqueue and retrieval", () => {
    let queue: OfflineSyncQueueManager;

    beforeEach(() => {
      queue = new OfflineSyncQueueManager();
    });

    it("enqueues an item with pending status and default retries", () => {
      const item = queue.enqueue("favorite", { venueId: "v123" });
      expect(item.id).toBeDefined();
      expect(item.type).toBe("favorite");
      expect(item.payload).toEqual({ venueId: "v123" });
      expect(item.status).toBe("pending");
      expect(item.attempts).toBe(0);
      expect(item.maxRetries).toBe(DEFAULT_QUEUE_CONFIG.maxRetries);

      const retrieved = queue.getItem(item.id);
      expect(retrieved).toEqual(item);
    });

    it("supports custom IDs and maxRetries options", () => {
      const item = queue.enqueue(
        "rating",
        { venueId: "v456", rating: 5 },
        { id: "custom-id-1", maxRetries: 2 },
      );
      expect(item.id).toBe("custom-id-1");
      expect(item.maxRetries).toBe(2);
    });

    it("filters items by status correctly", () => {
      const i1 = queue.enqueue("type1", { a: 1 });
      const i2 = queue.enqueue("type2", { b: 2 });

      expect(queue.getItems("pending").length).toBe(2);
      expect(queue.getItems("completed").length).toBe(0);
      expect(queue.getItems().length).toBe(2);
    });

    it("computes accurate aggregate queue statistics", () => {
      queue.enqueue("a", 1);
      queue.enqueue("b", 2);

      const stats = queue.getStats();
      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.deadLetter).toBe(0);
    });
  });

  describe("Queue processing and state transitions", () => {
    it("successfully processes pending items to completed", async () => {
      const queue = new OfflineSyncQueueManager();
      const processed: string[] = [];

      queue.enqueue("test1", "payload1");
      queue.enqueue("test2", "payload2");

      const stats = await queue.process(async (item) => {
        processed.push(item.id);
      });

      expect(processed.length).toBe(2);
      expect(stats.completed).toBe(2);
      expect(stats.pending).toBe(0);
      expect(queue.getItems("completed").length).toBe(2);
    });

    it("respects concurrency limit when processing items", async () => {
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      const queue = new OfflineSyncQueueManager({ concurrency: 2 });
      for (let i = 0; i < 6; i++) {
        queue.enqueue("item", i);
      }

      await queue.process(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 15));
        currentConcurrent--;
      });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(queue.getStats().completed).toBe(6);
    });

    it("schedules failed items for retry with backoff", async () => {
      const queue = new OfflineSyncQueueManager({
        baseDelayMs: 500,
        maxRetries: 3,
      });

      const item = queue.enqueue("flaky", { test: true });

      await queue.process(async () => {
        throw new Error("Simulated network timeout");
      });

      const updated = queue.getItem(item.id)!;
      expect(updated.status).toBe("retry");
      expect(updated.attempts).toBe(1);
      expect(updated.lastError).toBe("Simulated network timeout");
      expect(updated.nextAttemptAt).toBeGreaterThan(Date.now());
    });

    it("escalates failed items to dead_letter when maxRetries is reached", async () => {
      const queue = new OfflineSyncQueueManager({ maxRetries: 1 });
      const item = queue.enqueue("poison-pill", { bad: true }, { maxRetries: 1 });

      await queue.process(async () => {
        throw new Error("Permanent fatal error");
      });

      const updated = queue.getItem(item.id)!;
      expect(updated.status).toBe("dead_letter");
      expect(updated.attempts).toBe(1);
      expect(updated.lastError).toBe("Permanent fatal error");
      expect(queue.getStats().deadLetter).toBe(1);
    });

    it("skips items whose nextAttemptAt is in the future", async () => {
      const queue = new OfflineSyncQueueManager();
      const item = queue.enqueue("retry-item", {});
      item.status = "retry";
      item.nextAttemptAt = Date.now() + 10000; // 10 seconds in future

      let handled = false;
      await queue.process(async () => {
        handled = true;
      });

      expect(handled).toBe(false);
      expect(queue.getItem(item.id)!.status).toBe("retry");
    });
  });

  describe("Dead-Letter Queue management", () => {
    it("allows retrying a specific dead-letter item", () => {
      const queue = new OfflineSyncQueueManager();
      const item = queue.enqueue("failed-task", {});
      item.status = "dead_letter";
      item.attempts = 5;
      item.lastError = "Network error";

      const retriedCount = queue.retryDeadLetter(item.id);
      expect(retriedCount).toBe(1);

      const refreshed = queue.getItem(item.id)!;
      expect(refreshed.status).toBe("pending");
      expect(refreshed.attempts).toBe(0);
      expect(refreshed.lastError).toBeUndefined();
    });

    it("allows retrying all dead-letter items at once", () => {
      const queue = new OfflineSyncQueueManager();
      const i1 = queue.enqueue("f1", {});
      const i2 = queue.enqueue("f2", {});
      i1.status = "dead_letter";
      i2.status = "dead_letter";

      const count = queue.retryDeadLetter();
      expect(count).toBe(2);
      expect(queue.getStats().deadLetter).toBe(0);
      expect(queue.getStats().pending).toBe(2);
    });
  });

  describe("Queue maintenance: clearCompleted and clear", () => {
    it("purges only completed items from the queue", () => {
      const queue = new OfflineSyncQueueManager();
      const i1 = queue.enqueue("done", {});
      const i2 = queue.enqueue("waiting", {});
      i1.status = "completed";

      const purged = queue.clearCompleted();
      expect(purged).toBe(1);
      expect(queue.getItem(i1.id)).toBeUndefined();
      expect(queue.getItem(i2.id)).toBeDefined();
    });

    it("clears all items when clear() is called", () => {
      const queue = new OfflineSyncQueueManager();
      queue.enqueue("a", 1);
      queue.enqueue("b", 2);

      queue.clear();
      expect(queue.getStats().total).toBe(0);
    });
  });

  describe("Events and subscription", () => {
    it("emits events for queue lifecycle: start, progress, item_success, drained", async () => {
      const queue = new OfflineSyncQueueManager();
      const events: string[] = [];

      const unsubscribe = queue.subscribe((e: SyncQueueEvent) => {
        events.push(e.type);
      });

      queue.enqueue("event-test", {});
      await queue.process(async () => {});

      expect(events).toContain("queue:progress");
      expect(events).toContain("queue:start");
      expect(events).toContain("queue:item_success");
      expect(events).toContain("queue:drained");

      unsubscribe();
      queue.enqueue("another", {});
      const countBefore = events.length;
      expect(events.length).toBe(countBefore);
    });

    it("emits queue:item_dlq when item fails permanently", async () => {
      const queue = new OfflineSyncQueueManager({ maxRetries: 1 });
      const events: string[] = [];

      queue.subscribe((e) => {
        events.push(e.type);
      });

      queue.enqueue("fatal", {}, { maxRetries: 1 });
      await queue.process(async () => {
        throw new Error("Crash");
      });

      expect(events).toContain("queue:item_dlq");
    });
  });

  describe("Cancellation", () => {
    it("stops active processing when cancel() is invoked", async () => {
      const queue = new OfflineSyncQueueManager({ concurrency: 1 });
      queue.enqueue("i1", 1);
      queue.enqueue("i2", 2);

      let processedCount = 0;
      const processPromise = queue.process(async () => {
        processedCount++;
        queue.cancel();
      });

      await processPromise;
      expect(processedCount).toBe(1);
      expect(queue.isProcessing()).toBe(false);
    });
  });

  describe("Factory and singleton exports", () => {
    it("creates custom instance via createOfflineSyncQueue", () => {
      const custom = createOfflineSyncQueue({ concurrency: 5 });
      expect(custom).toBeInstanceOf(OfflineSyncQueueManager);
    });

    it("exports default globalSyncQueue instance", () => {
      expect(globalSyncQueue).toBeInstanceOf(OfflineSyncQueueManager);
    });
  });
});
