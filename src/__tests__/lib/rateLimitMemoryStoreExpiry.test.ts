import { MemoryRateLimitStore } from "@/lib/rateLimit/stores/memoryStore";

describe("MemoryRateLimitStore expired key cleanup on read and bulk lookup (#4794)", () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    jest.useRealTimers();
    store = new MemoryRateLimitStore(50);
  });

  describe("Sliding window single get cleanup", () => {
    it("returns entry if not yet expired", () => {
      const now = Date.now();
      store.setSlidingWindowEntry("user:1", {
        timestamps: [now],
        resetTime: now + 5000,
      });

      const entry = store.getSlidingWindowEntry("user:1");
      expect(entry).toBeDefined();
      expect(entry?.timestamps).toEqual([now]);
      expect(store.slidingWindowSize).toBe(1);
    });

    it("purges and returns undefined if sliding window entry is expired on get", () => {
      jest.useFakeTimers();
      const now = Date.now();
      store.setSlidingWindowEntry("user:expired", {
        timestamps: [now],
        resetTime: now + 1000,
      });

      expect(store.slidingWindowSize).toBe(1);

      // Advance past resetTime
      jest.advanceTimersByTime(1500);

      const entry = store.getSlidingWindowEntry("user:expired");
      expect(entry).toBeUndefined();
      expect(store.slidingWindowSize).toBe(0);
    });

    it("does not insert entry if it is already expired when calling setSlidingWindowEntry", () => {
      jest.useFakeTimers();
      const now = Date.now();
      store.setSlidingWindowEntry("user:old", {
        timestamps: [now - 5000],
        resetTime: now - 1000,
      });

      expect(store.slidingWindowSize).toBe(0);
      expect(store.getSlidingWindowEntry("user:old")).toBeUndefined();
    });
  });

  describe("Sliding window bulk lookup cleanup", () => {
    it("purges expired keys on the fly during bulk lookup", () => {
      jest.useFakeTimers();
      const now = Date.now();

      store.setSlidingWindowEntry("key:1", { timestamps: [now], resetTime: now + 5000 });
      store.setSlidingWindowEntry("key:2", { timestamps: [now], resetTime: now + 1000 }); // will expire
      store.setSlidingWindowEntry("key:3", { timestamps: [now], resetTime: now + 8000 });
      store.setSlidingWindowEntry("key:4", { timestamps: [now], resetTime: now + 500 });  // will expire

      expect(store.slidingWindowSize).toBe(4);

      // Advance 2 seconds -> key:2 and key:4 expire
      jest.advanceTimersByTime(2000);

      const results = store.getBulkSlidingWindowEntries(["key:1", "key:2", "key:3", "key:4", "key:missing"]);

      expect(results.size).toBe(2);
      expect(results.has("key:1")).toBe(true);
      expect(results.has("key:3")).toBe(true);
      expect(results.has("key:2")).toBe(false);
      expect(results.has("key:4")).toBe(false);

      // Verify expired keys were evicted from the internal store on the fly
      expect(store.slidingWindowSize).toBe(2);
      expect(store.getSlidingWindowEntry("key:2")).toBeUndefined();
      expect(store.getSlidingWindowEntry("key:4")).toBeUndefined();
    });
  });

  describe("Token bucket single get cleanup", () => {
    it("returns bucket if not yet expired", () => {
      const now = Date.now();
      store.setTokenBucketEntry("bucket:active", {
        tokens: 5,
        lastRefill: now,
        windowMs: 10_000,
      });

      const bucket = store.getTokenBucketEntry("bucket:active");
      expect(bucket).toBeDefined();
      expect(bucket?.tokens).toBe(5);
      expect(store.tokenBucketSize).toBe(1);
    });

    it("purges and returns undefined if token bucket is expired on get", () => {
      jest.useFakeTimers();
      const now = Date.now();
      store.setTokenBucketEntry("bucket:expired", {
        tokens: 2,
        lastRefill: now,
        windowMs: 5000,
      });

      expect(store.tokenBucketSize).toBe(1);

      // Advance past windowMs
      jest.advanceTimersByTime(6000);

      const bucket = store.getTokenBucketEntry("bucket:expired");
      expect(bucket).toBeUndefined();
      expect(store.tokenBucketSize).toBe(0);
    });

    it("does not insert entry if already expired when calling setTokenBucketEntry", () => {
      jest.useFakeTimers();
      const now = Date.now();
      store.setTokenBucketEntry("bucket:already_dead", {
        tokens: 10,
        lastRefill: now - 20_000,
        windowMs: 5000,
      });

      expect(store.tokenBucketSize).toBe(0);
      expect(store.getTokenBucketEntry("bucket:already_dead")).toBeUndefined();
    });
  });

  describe("Token bucket bulk lookup cleanup", () => {
    it("purges expired token bucket keys on the fly during bulk lookup", () => {
      jest.useFakeTimers();
      const now = Date.now();

      store.setTokenBucketEntry("tb:1", { tokens: 10, lastRefill: now, windowMs: 10_000 });
      store.setTokenBucketEntry("tb:2", { tokens: 5, lastRefill: now, windowMs: 2_000 }); // will expire
      store.setTokenBucketEntry("tb:3", { tokens: 8, lastRefill: now, windowMs: 15_000 });
      store.setTokenBucketEntry("tb:4", { tokens: 1, lastRefill: now, windowMs: 1_000 }); // will expire

      expect(store.tokenBucketSize).toBe(4);

      // Advance 3 seconds -> tb:2 and tb:4 expire
      jest.advanceTimersByTime(3000);

      const results = store.getBulkTokenBucketEntries(["tb:1", "tb:2", "tb:3", "tb:4", "tb:5"]);

      expect(results.size).toBe(2);
      expect(results.has("tb:1")).toBe(true);
      expect(results.has("tb:3")).toBe(true);
      expect(results.has("tb:2")).toBe(false);
      expect(results.has("tb:4")).toBe(false);

      expect(store.tokenBucketSize).toBe(2);
      expect(store.getTokenBucketEntry("tb:2")).toBeUndefined();
      expect(store.getTokenBucketEntry("tb:4")).toBeUndefined();
    });
  });

  describe("Memory bounds & LRU eviction", () => {
    it("keeps memory bounded under heavy key creation", () => {
      const smallStore = new MemoryRateLimitStore(5);
      const now = Date.now();

      for (let i = 0; i < 20; i++) {
        smallStore.setSlidingWindowEntry(`key:${i}`, {
          timestamps: [now],
          resetTime: now + 60_000,
        });
      }

      expect(smallStore.slidingWindowSize).toBeLessThanOrEqual(5);
    });

    it("clears all entries without memory leak", () => {
      store.setSlidingWindowEntry("s1", { timestamps: [], resetTime: Date.now() + 1000 });
      store.setTokenBucketEntry("t1", { tokens: 1, lastRefill: Date.now(), windowMs: 1000 });

      expect(store.size).toBe(2);
      store.clearAll();
      expect(store.size).toBe(0);
    });
  });
});
