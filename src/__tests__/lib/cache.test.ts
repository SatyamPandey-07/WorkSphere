import { LRUCache } from "../../lib/cache";

describe("LRUCache Memory Leak Fix", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("should proactively remove expired items via the background interval", () => {
    const ttlMs = 500;
    const capacity = 100;

    // Create the cache instance
    const cache = new LRUCache<string>(capacity, ttlMs);

    // 1. Insert an item
    cache.set("test-key", "test-value");

    // 2. Verify it's accessible immediately
    expect(cache.get("test-key")).toBe("test-value");

    // Re-insert to reset the TTL
    cache.set("test-key", "test-value");

    // 3. Fast-forward time past the TTL and the cleanup interval.
    // The constructor sets the interval to Math.max(1000, Math.min(ttlMs, 60000))
    // So for 500ms TTL, the interval runs every 1000ms.
    jest.advanceTimersByTime(1100);

    // 4. Access the raw underlying Map to verify it was evicted automatically.
    const internalMap = (cache as any).cache as Map<string, any>;

    // With our proactive interval fix, it should be false!
    expect(internalMap.has("test-key")).toBe(false);

    // Clean up interval to keep test runners happy
    if (cache.dispose) {
      cache.dispose();
    }
  });
});
