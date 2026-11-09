import { LRUCache } from "../lib/cache";

describe("LRUCache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should store and retrieve values", () => {
    const cache = new LRUCache<string>(3, 1000);
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("should return undefined for missing keys", () => {
    const cache = new LRUCache<string>(3, 1000);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("should evict the least recently used item when capacity is exceeded", () => {
    const cache = new LRUCache<number>(3, 1000);
    
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
    const cache = new LRUCache<string>(3, 1000); // 1 second TTL
    
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
    const cache = new LRUCache<number>(2, 1000);
    
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
    const cache = new LRUCache<string>(3, 1000);
    cache.set("test", "value");
    expect(cache.get("test")).toBe("value");
    
    cache.invalidate("test");
    expect(cache.get("test")).toBeUndefined();
  });

  it("should clear all keys correctly", () => {
    const cache = new LRUCache<number>(3, 1000);
    cache.set("1", 1);
    cache.set("2", 2);
    
    cache.clear();
    
    expect(cache.get("1")).toBeUndefined();
    expect(cache.get("2")).toBeUndefined();
  });

  it("should validate capacity and throw on non-positive or non-finite values", () => {
    expect(() => new LRUCache<string>(0, 1000)).toThrow("Capacity must be greater than 0");
    expect(() => new LRUCache<string>(-5, 1000)).toThrow("Capacity must be greater than 0");
    expect(() => new LRUCache<string>(NaN, 1000)).toThrow("Capacity must be greater than 0");
    expect(() => new LRUCache<string>(0.5, 1000)).toThrow("Capacity must be greater than 0");
    expect(() => new LRUCache<string>("invalid" as any, 1000)).toThrow("Capacity must be greater than 0");
  });

  it("should normalize fractional capacity", () => {
    const cache = new LRUCache<number>(2.9, 1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    // Capacity 2 should evict "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("should validate ttlMs and throw on non-positive or non-finite values", () => {
    expect(() => new LRUCache<string>(3, 0)).toThrow("TTL must be a positive number in milliseconds");
    expect(() => new LRUCache<string>(3, -100)).toThrow("TTL must be a positive number in milliseconds");
    expect(() => new LRUCache<string>(3, NaN)).toThrow("TTL must be a positive number in milliseconds");
    expect(() => new LRUCache<string>(3, "invalid" as any)).toThrow("TTL must be a positive number in milliseconds");
  });

  it("should check existence without altering LRU order using has()", () => {
    const cache = new LRUCache<string>(2, 1000);
    cache.set("first", "v1");
    cache.set("second", "v2");

    expect(cache.has("first")).toBe(true);
    expect(cache.has("second")).toBe(true);
    expect(cache.has("missing")).toBe(false);

    // Calling has("first") must NOT promote "first" to MRU
    // Adding "third" must evict "first" because it remained LRU
    cache.set("third", "v3");
    expect(cache.has("first")).toBe(false);
    expect(cache.has("second")).toBe(true);
    expect(cache.has("third")).toBe(true);
  });

  it("should return false for expired items in has() and lazily remove them", () => {
    const cache = new LRUCache<string>(2, 1000);
    cache.set("expiring", "value");

    expect(cache.has("expiring")).toBe(true);
    jest.advanceTimersByTime(1001);

    expect(cache.has("expiring")).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("should report size correctly through the size getter", () => {
    const cache = new LRUCache<string>(3, 1000);
    expect(cache.size).toBe(0);

    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.size).toBe(2);

    cache.set("a", "1-updated");
    expect(cache.size).toBe(2);

    cache.set("c", "3");
    cache.set("d", "4"); // evicts "b"
    expect(cache.size).toBe(3);

    cache.invalidate("c");
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
  });
});
