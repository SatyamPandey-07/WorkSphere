import { LRUCache } from "../lib/cache";

describe("LRUCache", () => {
  let cache: LRUCache<any>;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Ensure sweep timers are cleaned up after every test
    if (cache) {
      cache.destroy();
    }
    jest.useRealTimers();
  });

  it("should store and retrieve values", () => {
    cache = new LRUCache<string>(3, 1000);
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("should return undefined for missing keys", () => {
    cache = new LRUCache<string>(3, 1000);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("should evict the least recently used item when capacity is exceeded", () => {
    cache = new LRUCache<number>(3, 1000);

    cache.set("1", 1);
    cache.set("2", 2);
    cache.set("3", 3);

    // Cache is now full: [1, 2, 3]

    // Access "1" to make it most recently used
    cache.get("1"); // Cache order: [2, 3, 1]

    // Add a new item to trigger eviction
    cache.set("4", 4); // "2" should be evicted

    expect(cache.get("2")).toBeUndefined();
    expect(cache.get("1")).toBe(1);
    expect(cache.get("3")).toBe(3);
    expect(cache.get("4")).toBe(4);
  });

  it("should handle TTL expiration correctly", () => {
    cache = new LRUCache<string>(3, 1000); // 1 second TTL

    cache.set("temp", "data");
    expect(cache.get("temp")).toBe("data");

    // Fast forward 500ms
    jest.advanceTimersByTime(500);
    expect(cache.get("temp")).toBe("data");

    // Fast forward another 501ms (total 1001ms)
    jest.advanceTimersByTime(501);
    expect(cache.get("temp")).toBeUndefined();
  });

  it("should correctly update existing keys without exceeding capacity", () => {
    cache = new LRUCache<number>(2, 1000);

    cache.set("a", 1);
    cache.set("b", 2);

    // Update "a"
    cache.set("a", 10);

    // Add "c"
    cache.set("c", 3); // "b" should be evicted because "a" was updated

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
  });

  it("should invalidate keys correctly", () => {
    cache = new LRUCache<string>(3, 1000);
    cache.set("test", "value");
    expect(cache.get("test")).toBe("value");

    cache.invalidate("test");
    expect(cache.get("test")).toBeUndefined();
  });

  it("should clear all keys correctly", () => {
    cache = new LRUCache<number>(3, 1000);
    cache.set("1", 1);
    cache.set("2", 2);

    cache.clear();

    expect(cache.get("1")).toBeUndefined();
    expect(cache.get("2")).toBeUndefined();
  });

  // --- New tests for proactive sweep (issue #489) ---

  it("should automatically sweep expired entries without calling get()", () => {
    // Use explicit sweep interval of 500ms, TTL of 1000ms
    cache = new LRUCache<string>(100, 1000, 500);

    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.size).toBe(3);

    // Advance past TTL
    jest.advanceTimersByTime(1001);

    // Advance past at least one sweep interval so the sweep fires
    jest.advanceTimersByTime(500);

    // Entries should be removed by the sweep, not by get()
    expect(cache.size).toBe(0);
  });

  it("should not sweep entries whose TTL has not yet expired", () => {
    cache = new LRUCache<string>(100, 2000, 500);

    cache.set("x", "value");
    expect(cache.size).toBe(1);

    // Advance past one sweep interval, but NOT past TTL
    jest.advanceTimersByTime(600);

    // Entry should still be present
    expect(cache.size).toBe(1);
    expect(cache.get("x")).toBe("value");
  });

  it("should clean up the sweep timer on destroy()", () => {
    cache = new LRUCache<string>(10, 1000);
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");

    cache.destroy();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(cache.size).toBe(0);

    clearIntervalSpy.mockRestore();
  });

  it("should stop the sweep timer on clear()", () => {
    cache = new LRUCache<string>(10, 1000);
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");

    cache.set("k", "v");
    cache.clear();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(cache.size).toBe(0);

    clearIntervalSpy.mockRestore();
  });
});
