import {
  MemoryRateLimitStore,
  defaultMemoryStore,
} from "@/lib/rateLimit/stores/memoryStore";

describe("Tiered Rate Limiter Memory-Bounded Fallback Store", () => {
  afterEach(() => {
    defaultMemoryStore.clearAll();
  });

  it("strictly enforces max capacity cap and evicts oldest entry in sliding window store", () => {
    const customCapacity = 50;
    const store = new MemoryRateLimitStore(customCapacity);

    // Insert 100 unique keys
    for (let i = 0; i < 100; i++) {
      store.setSlidingWindowEntry(`ip-client-${i}`, {
        timestamps: [Date.now()],
        resetTime: Date.now() + 60_000,
      });
    }

    expect(store.slidingWindowSize).toBe(customCapacity);

    // The earliest inserted keys (0 to 49) should have been evicted
    expect(store.getSlidingWindowEntry("ip-client-0")).toBeUndefined();
    expect(store.getSlidingWindowEntry("ip-client-49")).toBeUndefined();

    // The latest inserted keys (50 to 99) should be present
    expect(store.getSlidingWindowEntry("ip-client-50")).toBeDefined();
    expect(store.getSlidingWindowEntry("ip-client-99")).toBeDefined();
  });

  it("refreshes LRU recency on access so accessed items survive eviction", () => {
    const customCapacity = 3;
    const store = new MemoryRateLimitStore(customCapacity);

    store.setSlidingWindowEntry("ip-1", { timestamps: [Date.now()], resetTime: Date.now() + 60_000 });
    store.setSlidingWindowEntry("ip-2", { timestamps: [Date.now()], resetTime: Date.now() + 60_000 });
    store.setSlidingWindowEntry("ip-3", { timestamps: [Date.now()], resetTime: Date.now() + 60_000 });

    // Access ip-1 to move it to the most recently used position
    store.getSlidingWindowEntry("ip-1");

    // Insert ip-4, which should evict ip-2 (the oldest unaccessed item) instead of ip-1
    store.setSlidingWindowEntry("ip-4", { timestamps: [Date.now()], resetTime: Date.now() + 60_000 });

    expect(store.getSlidingWindowEntry("ip-1")).toBeDefined();
    expect(store.getSlidingWindowEntry("ip-2")).toBeUndefined();
    expect(store.getSlidingWindowEntry("ip-3")).toBeDefined();
    expect(store.getSlidingWindowEntry("ip-4")).toBeDefined();
  });

  it("strictly enforces max capacity cap on token bucket store", () => {
    const customCapacity = 25;
    const store = new MemoryRateLimitStore(customCapacity);

    for (let i = 0; i < 60; i++) {
      store.setTokenBucketEntry(`user-bucket-${i}`, {
        tokens: 10,
        lastRefill: Date.now(),
      });
    }

    expect(store.tokenBucketSize).toBe(customCapacity);
    expect(store.getTokenBucketEntry("user-bucket-0")).toBeUndefined();
    expect(store.getTokenBucketEntry("user-bucket-59")).toBeDefined();
  });

  it("simulates high volume (20,000 distinct IPs) without memory leakage", () => {
    const store = new MemoryRateLimitStore(10_000);

    for (let i = 0; i < 20_000; i++) {
      store.setSlidingWindowEntry(`10.0.${Math.floor(i / 256)}.${i % 256}`, {
        timestamps: [Date.now()],
        resetTime: Date.now() + 60_000,
      });
    }

    expect(store.slidingWindowSize).toBe(10_000);
    expect(store.size).toBeLessThanOrEqual(10_000);
  });

  it("cleans up expired entries before evicting live entries when capacity is reached", () => {
    const store = new MemoryRateLimitStore(5);
    const pastTime = Date.now() - 10_000;

    // Insert expired entries
    store.setSlidingWindowEntry("expired-1", { timestamps: [pastTime], resetTime: pastTime });
    store.setSlidingWindowEntry("expired-2", { timestamps: [pastTime], resetTime: pastTime });

    // Insert active entries
    store.setSlidingWindowEntry("active-1", { timestamps: [Date.now()], resetTime: Date.now() + 60_000 });
    store.setSlidingWindowEntry("active-2", { timestamps: [Date.now()], resetTime: Date.now() + 60_000 });
    store.setSlidingWindowEntry("active-3", { timestamps: [Date.now()], resetTime: Date.now() + 60_000 });

    // Store is at capacity (5). Inserting a 6th item should trigger cleanup and purge expired entries
    store.setSlidingWindowEntry("active-4", { timestamps: [Date.now()], resetTime: Date.now() + 60_000 });

    expect(store.getSlidingWindowEntry("expired-1")).toBeUndefined();
    expect(store.getSlidingWindowEntry("expired-2")).toBeUndefined();
    expect(store.getSlidingWindowEntry("active-1")).toBeDefined();
    expect(store.getSlidingWindowEntry("active-4")).toBeDefined();
  });
});
