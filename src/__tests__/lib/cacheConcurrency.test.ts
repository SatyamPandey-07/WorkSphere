import { LRUCache } from "../../lib/cache";

describe("LRUCache Concurrent Stress & Pointer Symmetry (#4381)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("maintains strict doubly-linked list pointer symmetry during eviction", () => {
    const capacity = 5;
    const cache = new LRUCache<number>(capacity, 60000);

    // Populate to full capacity
    for (let i = 1; i <= capacity; i++) {
      cache.set(`key-${i}`, i);
      expect(cache.verifyIntegrity()).toBe(true);
    }

    // Trigger evictions by adding new items
    for (let i = capacity + 1; i <= capacity + 10; i++) {
      cache.set(`key-${i}`, i);
      expect(cache.verifyIntegrity()).toBe(true);
    }

    // Oldest items (1..10) should be evicted
    expect(cache.get("key-1")).toBeUndefined();
    expect(cache.get("key-2")).toBeUndefined();
    expect(cache.get("key-15")).toBe(15);
    expect(cache.verifyIntegrity()).toBe(true);
  });

  test("prevents dangling node references when updating existing keys", () => {
    const cache = new LRUCache<string>(3, 60000);

    cache.set("a", "alpha");
    cache.set("b", "beta");
    cache.set("c", "gamma");

    expect(cache.verifyIntegrity()).toBe(true);

    // Update existing key "a" multiple times
    cache.set("a", "alpha-v2");
    expect(cache.verifyIntegrity()).toBe(true);
    cache.set("a", "alpha-v3");
    expect(cache.verifyIntegrity()).toBe(true);

    // Evict least recently used (should be "b")
    cache.set("d", "delta");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("alpha-v3");
    expect(cache.get("c")).toBe("gamma");
    expect(cache.get("d")).toBe("delta");
    expect(cache.verifyIntegrity()).toBe(true);
  });

  test("handles high-volume concurrent async operations without pointer corruption", async () => {
    const cache = new LRUCache<string>(10, 60000);
    const operations: Promise<void>[] = [];

    // Concurrent read/write stress loop
    for (let i = 0; i < 500; i++) {
      const key = `key-${i % 25}`;
      operations.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (i % 3 === 0) {
              cache.set(key, `val-${i}`);
            } else if (i % 3 === 1) {
              cache.get(key);
            } else {
              cache.invalidate(key);
            }
            expect(cache.verifyIntegrity()).toBe(true);
            resolve();
          }, Math.floor(Math.random() * 50));
        })
      );
    }

    jest.advanceTimersByTime(100);
    await Promise.all(operations);

    expect(cache.verifyIntegrity()).toBe(true);
  });

  test("proactively cleans up expired items preserving list integrity", () => {
    const cache = new LRUCache<string>(10, 500);

    for (let i = 1; i <= 5; i++) {
      cache.set(`k-${i}`, `v-${i}`);
    }

    expect(cache.verifyIntegrity()).toBe(true);

    // Advance timers past TTL
    jest.advanceTimersByTime(1100);

    expect(cache.get("k-1")).toBeUndefined();
    expect(cache.verifyIntegrity()).toBe(true);

    cache.dispose();
  });
});
