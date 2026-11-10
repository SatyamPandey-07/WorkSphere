/**
 * Unit tests for multi-tier Stale-While-Revalidate (SWR) Redis cache utility.
 *
 * Covers:
 * - Cache Miss (synchronous DB/fetcher call + atomic Redis Lua population)
 * - Fresh Cache Hit (instant return without fetcher invocation)
 * - Stale Cache Hit (instant return + async background revalidation)
 * - Background revalidation deduplication (mutex protection against thundering herd)
 * - Invalidation Race Condition Guards (generation token discards in-flight background stale revalidation)
 * - Synchronous Cache-Miss Invalidation Race (aborts Redis & memory write-back if invalidated while pending)
 * - In-flight Promise Deletion Race (promise finally block identity check protects newer in-flight promises)
 * - Redis-Side Atomic Lua Script Interleaving (Multi-Instance Correctness)
 * - Globally Unique Crypto UUID Tokens (independent of clocks, immune to clock skew)
 * - Version Key Eviction & Reinitialization Protection (never reuses tokens across generations)
 * - Strict Atomic Safety (does NOT fall back to unsafe non-atomic redis.set/redis.del when eval is unavailable)
 * - Redis Failure / Outage Fallback (directly queries Prisma, never serves stale memory data on error)
 * - Redis Unconfigured Fallback (in-memory Tier 1 for local development)
 * - Cache Invalidation (purges key from Redis and in-memory cache)
 *
 * Issue #7266
 */

import {
  swrCache,
  triggerBackgroundRevalidation,
  invalidateVenueReviewsCache,
  invalidateCacheKey,
  clearMemorySWRCache,
  getVenueReviewsCacheKey,
  getCacheVersionKey,
  generateGenerationToken,
  LUA_ATOMIC_GET_OR_INIT_VERSION,
  LUA_ATOMIC_INVALIDATE,
  LUA_ATOMIC_SET_IF_VERSION_MATCH,
  inMemorySWRCache,
  inFlightRevalidations,
} from "@/lib/cache/swrCache";

describe("swrCache Utility (Issue #7266)", () => {
  const testKey = "test:swr:resource:123";
  let mockRedis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    eval: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clearMemorySWRCache();

    mockRedis = {
      get: jest.fn().mockImplementation(async (k: string) => {
        if (k.endsWith(":version")) return "uuid-test-token-1";
        return null;
      }),
      set: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockImplementation(async (script: string) => {
        if (script.includes("NX")) return "uuid-test-token-1";
        if (script.includes("DEL")) return "uuid-test-token-2";
        return 1;
      }),
    };
  });

  describe("Cache Miss", () => {
    it("calls fetcher and saves result to Redis atomically via Lua with stale TTL", async () => {
      const fetcher = jest
        .fn()
        .mockResolvedValue({ id: 1, title: "Fresh Review" });

      const result = await swrCache(testKey, fetcher, {
        freshTtlSeconds: 300,
        staleTtlSeconds: 3600,
        redisClient: mockRedis,
      });

      expect(result).toEqual({ id: 1, title: "Fresh Review" });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(mockRedis.get).toHaveBeenCalledWith(testKey);

      // Verify eval was called (getOrInitVersion + setIfVersionMatch)
      expect(mockRedis.eval).toHaveBeenCalledWith(
        LUA_ATOMIC_GET_OR_INIT_VERSION,
        [getCacheVersionKey(testKey)],
        [expect.any(String)],
      );
      expect(mockRedis.eval).toHaveBeenCalledWith(
        LUA_ATOMIC_SET_IF_VERSION_MATCH,
        [testKey, getCacheVersionKey(testKey)],
        ["uuid-test-token-1", expect.any(String), "3600"],
      );
    });
  });

  describe("Fresh Cache Hit", () => {
    it("returns cached data immediately without invoking fetcher", async () => {
      const freshEnvelope = {
        data: [{ id: "rev-1", rating: 5, comment: "Excellent wifi" }],
        cachedAt: Date.now() - 60 * 1000, // 1 minute ago (< 5 minutes fresh TTL)
      };
      mockRedis.get.mockImplementation(async (k: string) => {
        if (k === testKey) return JSON.stringify(freshEnvelope);
        return null;
      });

      const fetcher = jest.fn();

      const result = await swrCache(testKey, fetcher, {
        freshTtlSeconds: 300,
        staleTtlSeconds: 3600,
        redisClient: mockRedis,
      });

      expect(result).toEqual(freshEnvelope.data);
      expect(fetcher).not.toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    it("handles pre-parsed object returned directly by Redis client", async () => {
      const freshEnvelope = {
        data: [{ id: "rev-2", rating: 4 }],
        cachedAt: Date.now() - 30 * 1000, // 30 seconds ago
      };
      mockRedis.get.mockImplementation(async (k: string) => {
        if (k === testKey) return freshEnvelope;
        return null;
      });

      const fetcher = jest.fn();

      const result = await swrCache(testKey, fetcher, {
        freshTtlSeconds: 300,
        redisClient: mockRedis,
      });

      expect(result).toEqual(freshEnvelope.data);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe("Stale Cache Hit with Background Revalidation", () => {
    it("returns stale data immediately and triggers background fetcher to update Redis atomically", async () => {
      const staleData = [{ id: "rev-old", comment: "Stale comment" }];
      const freshData = [{ id: "rev-new", comment: "Fresh updated comment" }];

      const staleEnvelope = {
        data: staleData,
        cachedAt: Date.now() - 600 * 1000, // 10 minutes ago (> 5m fresh TTL, < 60m stale window)
      };
      mockRedis.get.mockImplementation(async (k: string) => {
        if (k === testKey) return JSON.stringify(staleEnvelope);
        if (k.endsWith(":version")) return "uuid-test-token-1";
        return null;
      });

      let resolveFetcher: (val: any) => void = () => {};
      const fetcherPromise = new Promise((resolve) => {
        resolveFetcher = resolve;
      });
      const fetcher = jest.fn().mockImplementation(() => fetcherPromise);

      // 1. Call swrCache — should return immediately with staleData
      const result = await swrCache(testKey, fetcher, {
        freshTtlSeconds: 300,
        staleTtlSeconds: 3600,
        redisClient: mockRedis,
      });

      expect(result).toEqual(staleData);

      // Allow background microtask queue to capture version and invoke fetcher
      await new Promise((r) => setTimeout(r, 10));
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 2. Resolve background fetcher
      resolveFetcher(freshData);
      await fetcherPromise;

      // Allow background write to settle
      await new Promise((r) => setTimeout(r, 10));

      // 3. Verify Redis eval was called in background with freshData
      expect(mockRedis.eval).toHaveBeenCalledWith(
        LUA_ATOMIC_SET_IF_VERSION_MATCH,
        [testKey, getCacheVersionKey(testKey)],
        ["uuid-test-token-1", expect.any(String), "3600"],
      );
    });

    it("deduplicates concurrent background revalidations for identical key", async () => {
      const staleEnvelope = {
        data: "initial-data",
        cachedAt: Date.now() - 400 * 1000, // stale
      };
      mockRedis.get.mockImplementation(async (k: string) => {
        if (k === testKey) return JSON.stringify(staleEnvelope);
        if (k.endsWith(":version")) return "uuid-test-token-1";
        return null;
      });

      let fetcherCount = 0;
      const fetcher = jest.fn().mockImplementation(async () => {
        fetcherCount++;
        await new Promise((r) => setTimeout(r, 50));
        return `revalidated-${fetcherCount}`;
      });

      // Fire 3 simultaneous requests on stale cache
      const [res1, res2, res3] = await Promise.all([
        swrCache(testKey, fetcher, { redisClient: mockRedis }),
        swrCache(testKey, fetcher, { redisClient: mockRedis }),
        swrCache(testKey, fetcher, { redisClient: mockRedis }),
      ]);

      expect(res1).toBe("initial-data");
      expect(res2).toBe("initial-data");
      expect(res3).toBe("initial-data");

      // Allow background task to kick off
      await new Promise((r) => setTimeout(r, 10));

      // Verify fetcher was invoked only ONCE despite 3 concurrent calls
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe("Invalidation Race Condition Guards (Generation Tokens & Promise Identity)", () => {
    it("discards pending background fetch and prevents it from overwriting invalidated cache", async () => {
      const staleData = [{ id: "rev-1", comment: "Old review" }];
      const staleEnvelope = {
        data: staleData,
        cachedAt: Date.now() - 600 * 1000,
      };
      mockRedis.get.mockImplementation(async (k: string) => {
        if (k === testKey) return JSON.stringify(staleEnvelope);
        if (k.endsWith(":version")) return "uuid-test-token-1";
        return null;
      });

      let resolveBackgroundFetcher: (val: any) => void = () => {};
      const pendingFetchPromise = new Promise((resolve) => {
        resolveBackgroundFetcher = resolve;
      });
      const fetcher = jest.fn().mockImplementation(() => pendingFetchPromise);

      // 1. Initial request triggers background revalidation
      const res = await swrCache(testKey, fetcher, { redisClient: mockRedis });
      expect(res).toEqual(staleData);

      // Allow background task to capture version and start fetch
      await new Promise((r) => setTimeout(r, 10));
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Reset mockRedis trackers to observe any write-backs
      mockRedis.eval.mockClear();

      // 2. While background fetch is pending, user submits a review and invalidates cache
      await invalidateCacheKey(testKey, { redisClient: mockRedis });
      expect(mockRedis.eval).toHaveBeenCalledWith(
        LUA_ATOMIC_INVALIDATE,
        [testKey, getCacheVersionKey(testKey)],
        [expect.any(String)],
      );
      expect(inMemorySWRCache.has(testKey)).toBe(false);

      // Clear mock call from invalidation
      mockRedis.eval.mockClear();

      // 3. Now the delayed background fetch finally finishes
      resolveBackgroundFetcher([{ id: "rev-stale-from-old-query" }]);
      await pendingFetchPromise;
      await new Promise((r) => setTimeout(r, 10));

      // 4. VERIFY: Old background fetch did NOT re-populate Redis or in-memory cache
      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(inMemorySWRCache.has(testKey)).toBe(false);
    });

    it("synchronous cache-miss: aborts write-back to Redis and memory if invalidated while fetch was pending", async () => {
      mockRedis.get.mockResolvedValue(null);

      let resolveMissFetcher: (val: any) => void = () => {};
      const pendingMissPromise = new Promise((resolve) => {
        resolveMissFetcher = resolve;
      });
      const fetcher = jest.fn().mockImplementation(() => pendingMissPromise);

      // 1. Start synchronous cache-miss fetch
      const cacheMissPromise = swrCache(testKey, fetcher, {
        redisClient: mockRedis,
      });

      // Allow microtask queue to capture version before fetcher() is invoked
      await new Promise((r) => setTimeout(r, 10));
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Clear mock calls
      mockRedis.eval.mockClear();

      // 2. While synchronous fetch is still pending, an invalidation occurs
      await invalidateCacheKey(testKey, { redisClient: mockRedis });
      expect(mockRedis.eval).toHaveBeenCalledWith(
        LUA_ATOMIC_INVALIDATE,
        [testKey, getCacheVersionKey(testKey)],
        [expect.any(String)],
      );

      // Clear mock call from invalidation
      mockRedis.eval.mockClear();

      // 3. Now the slow cache-miss fetch resolves
      resolveMissFetcher({ id: "stale-miss-record" });
      const returnedData = await cacheMissPromise;

      // 4. VERIFY: Although returnedData was sent to the original caller,
      // it was NOT saved to Redis or memory because an invalidation happened during the fetch!
      expect(returnedData).toEqual({ id: "stale-miss-record" });
      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(inMemorySWRCache.has(testKey)).toBe(false);
    });

    it("in-flight promise deletion: older promise finally block does not delete newer in-flight promise from Map", async () => {
      // 1. Start promise 1
      let resolveFetcher1: (val: any) => void = () => {};
      const fetcher1Promise = new Promise((resolve) => {
        resolveFetcher1 = resolve;
      });
      const fetcher1 = jest.fn().mockImplementation(() => fetcher1Promise);
      const promise1 = triggerBackgroundRevalidation(testKey, fetcher1, {
        redisClient: mockRedis,
      });

      expect(inFlightRevalidations.get(testKey)).toBe(promise1);

      // 2. Invalidate cache (clears inFlightRevalidations Map)
      await invalidateCacheKey(testKey, { redisClient: mockRedis });
      expect(inFlightRevalidations.has(testKey)).toBe(false);

      // 3. Start a new background revalidation (promise 2)
      let resolveFetcher2: (val: any) => void = () => {};
      const fetcher2Promise = new Promise((resolve) => {
        resolveFetcher2 = resolve;
      });
      const fetcher2 = jest.fn().mockImplementation(() => fetcher2Promise);
      const promise2 = triggerBackgroundRevalidation(testKey, fetcher2, {
        redisClient: mockRedis,
      });

      expect(inFlightRevalidations.get(testKey)).toBe(promise2);

      // 4. Resolve older promise 1 — its finally block executes now
      resolveFetcher1("old-data-1");
      await promise1;

      // 5. VERIFY: promise 2 is STILL in inFlightRevalidations Map!
      // promise 1's finally block did NOT delete promise 2!
      expect(inFlightRevalidations.get(testKey)).toBe(promise2);

      // 6. Calling triggerBackgroundRevalidation again returns promise 2 (deduplication works!)
      const fetcher3 = jest.fn();
      const existingPromise = triggerBackgroundRevalidation(testKey, fetcher3, {
        redisClient: mockRedis,
      });
      expect(existingPromise).toBe(promise2);
      expect(fetcher3).not.toHaveBeenCalled();

      // Clean up promise 2
      resolveFetcher2("new-data-2");
      await promise2;
      expect(inFlightRevalidations.has(testKey)).toBe(false);
    });
  });

  describe("Redis-Side Atomic Lua Script Interleaving (Multi-Instance Correctness)", () => {
    interface RedisStore {
      data: Map<string, string>;
      versions: Map<string, string>;
    }

    function createSimulatedRedis() {
      const store: RedisStore = {
        data: new Map<string, string>(),
        versions: new Map<string, string>(),
      };

      const get = jest.fn().mockImplementation(async (k: string) => {
        if (k.endsWith(":version")) {
          return store.versions.has(k) ? store.versions.get(k) : null;
        }
        return store.data.get(k) ?? null;
      });

      const set = jest.fn().mockImplementation(async (k: string, v: string) => {
        store.data.set(k, v);
        return "OK";
      });

      const del = jest.fn().mockImplementation(async (k: string) => {
        const existed = store.data.delete(k);
        return existed ? 1 : 0;
      });

      const evalFn = jest
        .fn()
        .mockImplementation(
          async (script: string, keys: string[], args: string[]) => {
            // 1. Simulate LUA_ATOMIC_GET_OR_INIT_VERSION
            if (script.includes("NX")) {
              const [versionKey] = keys;
              const token = args[0];
              if (!store.versions.has(versionKey)) {
                store.versions.set(versionKey, token);
              }
              return store.versions.get(versionKey)!;
            }

            // 2. Simulate LUA_ATOMIC_INVALIDATE
            if (script.includes("DEL") && script.includes("SET")) {
              const [cacheKey, versionKey] = keys;
              const newToken = args[0];
              store.versions.set(versionKey, newToken);
              store.data.delete(cacheKey);
              return newToken;
            }

            // 3. Simulate LUA_ATOMIC_SET_IF_VERSION_MATCH
            if (script.includes("GET") && script.includes("ARGV[1]")) {
              const [cacheKey, versionKey] = keys;
              const expectedVer = args[0];
              const payload = args[1];

              // If version key does not exist (or expired), fail closed and return 0
              if (!store.versions.has(versionKey)) {
                return 0;
              }

              const currentVer = store.versions.get(versionKey);
              if (currentVer === String(expectedVer)) {
                store.data.set(cacheKey, payload);
                return 1;
              } else {
                return 0; // Rejected atomically by Redis Lua!
              }
            }

            throw new Error("Unknown Lua script in simulated Redis");
          },
        );

      return { store, get, set, del, eval: evalFn };
    }

    it("multi-instance crypto tokens: generates distinct random UUID tokens regardless of timestamps", () => {
      const token1 = generateGenerationToken();
      const token2 = generateGenerationToken();
      const token3 = generateGenerationToken();

      expect(token1).not.toBe(token2);
      expect(token2).not.toBe(token3);
      expect(token1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("multi-instance atomic write: saves to Redis when version matches", async () => {
      const simRedis = createSimulatedRedis();
      const fetcher = jest
        .fn()
        .mockResolvedValue({ id: "fresh-1", text: "Fresh review" });

      const result = await swrCache(testKey, fetcher, {
        redisClient: simRedis,
      });

      expect(result).toEqual({ id: "fresh-1", text: "Fresh review" });
      expect(simRedis.eval).toHaveBeenCalledTimes(2); // getOrInit + setIfMatch
      expect(simRedis.store.data.has(testKey)).toBe(true);
      const parsed = JSON.parse(simRedis.store.data.get(testKey)!);
      expect(parsed.data).toEqual({ id: "fresh-1", text: "Fresh review" });
    });

    it("Instance A fetch start -> Instance B invalidate -> A fetch complete: stale write rejected", async () => {
      const simRedis = createSimulatedRedis();

      let resolveSlowFetcher: (val: any) => void = () => {};
      const slowFetcherPromise = new Promise((resolve) => {
        resolveSlowFetcher = resolve;
      });
      const fetcher = jest.fn().mockImplementation(() => slowFetcherPromise);

      // 1. Instance A starts cache-miss: reads/initializes version in Redis BEFORE fetcher runs
      const cachePromise = swrCache(testKey, fetcher, {
        redisClient: simRedis,
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Captured version in Redis is known
      const versionKey = getCacheVersionKey(testKey);
      const initialVer = simRedis.store.versions.get(versionKey);
      expect(initialVer).toBeDefined();

      // 2. While Instance A's fetch is pending, Instance B invalidates the cache key
      await invalidateCacheKey(testKey, { redisClient: simRedis });
      // Invalidation executed LUA_ATOMIC_INVALIDATE on Redis: sets new UUID token
      const updatedVer = simRedis.store.versions.get(versionKey);
      expect(updatedVer).toBeDefined();
      expect(updatedVer).not.toBe(initialVer);
      expect(simRedis.store.data.has(testKey)).toBe(false);

      // 3. Instance A's slow fetch resolves with old data
      resolveSlowFetcher({ id: "stale-db-record" });
      const returned = await cachePromise;
      expect(returned).toEqual({ id: "stale-db-record" });

      // 4. VERIFY: Redis Lua rejected the write because UUID token in Redis changed
      expect(simRedis.store.data.has(testKey)).toBe(false);
      expect(inMemorySWRCache.has(testKey)).toBe(false);
    });

    it("version key eviction followed by reinitialization: old in-flight token cannot match new generation UUID", async () => {
      const simRedis = createSimulatedRedis();

      let resolveSlowFetcher: (val: any) => void = () => {};
      const slowFetcherPromise = new Promise((resolve) => {
        resolveSlowFetcher = resolve;
      });
      const fetcher = jest.fn().mockImplementation(() => slowFetcherPromise);

      // 1. Instance A starts fetch, captures initial UUID token
      const cachePromise = swrCache(testKey, fetcher, {
        redisClient: simRedis,
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(fetcher).toHaveBeenCalledTimes(1);

      const versionKey = getCacheVersionKey(testKey);
      const initialToken = simRedis.store.versions.get(versionKey);
      expect(initialToken).toBeDefined();

      // 2. Version key is evicted from Redis
      simRedis.store.versions.delete(versionKey);
      expect(simRedis.store.versions.has(versionKey)).toBe(false);

      // 3. Instance B triggers cache miss and reinitializes with a NEW UUID token
      const reinitFetcher = jest
        .fn()
        .mockResolvedValue({ id: "reinit-record" });
      await swrCache(testKey, reinitFetcher, { redisClient: simRedis });
      const newToken = simRedis.store.versions.get(versionKey);
      expect(newToken).toBeDefined();
      expect(newToken).not.toBe(initialToken);

      // 4. Instance A's old fetch now completes with old data
      resolveSlowFetcher({ id: "stale-db-record" });
      const returned = await cachePromise;
      expect(returned).toEqual({ id: "stale-db-record" });

      // 5. VERIFY: Old write was rejected! Cache still contains Instance B's data, NOT Instance A's stale data
      const currentPayload = JSON.parse(simRedis.store.data.get(testKey)!);
      expect(currentPayload.data).toEqual({ id: "reinit-record" });
    });

    it("version key eviction without reinitialization: fails closed and prevents stale write", async () => {
      const simRedis = createSimulatedRedis();

      let resolveSlowFetcher: (val: any) => void = () => {};
      const slowFetcherPromise = new Promise((resolve) => {
        resolveSlowFetcher = resolve;
      });
      const fetcher = jest.fn().mockImplementation(() => slowFetcherPromise);

      // 1. Fetch starts when versionKey exists in Redis
      const cachePromise = swrCache(testKey, fetcher, {
        redisClient: simRedis,
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 2. While fetch is in-flight, versionKey expires / is deleted from Redis
      const versionKey = getCacheVersionKey(testKey);
      simRedis.store.versions.delete(versionKey);
      expect(simRedis.store.versions.has(versionKey)).toBe(false);

      // 3. Old fetch finishes and attempts write
      resolveSlowFetcher({ id: "stale-db-record-post-expiry" });
      const returned = await cachePromise;
      expect(returned).toEqual({ id: "stale-db-record-post-expiry" });

      // 4. VERIFY: Redis Lua rejected the write because versionKey is missing (fails closed)
      expect(simRedis.store.data.has(testKey)).toBe(false);
      expect(inMemorySWRCache.has(testKey)).toBe(false);
    });

    it("background revalidation interleaving: Redis Lua rejects stale background write if invalidated concurrently", async () => {
      const simRedis = createSimulatedRedis();

      // Seed Redis with stale data (cachedAt = 10 minutes ago, stale TTL = 1 hour)
      const stalePayload = {
        data: [{ id: "stale-1" }],
        cachedAt: Date.now() - 600 * 1000,
        version: "uuid-init-100",
      };
      simRedis.store.data.set(testKey, JSON.stringify(stalePayload));
      simRedis.store.versions.set(getCacheVersionKey(testKey), "uuid-init-100");

      let resolveBackgroundFetcher: (val: any) => void = () => {};
      const bgPromise = new Promise((resolve) => {
        resolveBackgroundFetcher = resolve;
      });
      const fetcher = jest.fn().mockImplementation(() => bgPromise);

      // 1. Stale hit occurs, background revalidation starts (reads version uuid-init-100 before fetch)
      const res = await swrCache(testKey, fetcher, { redisClient: simRedis });
      expect(res).toEqual(stalePayload.data);

      await new Promise((r) => setTimeout(r, 10));
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 2. While background fetch is pending, an invalidation is triggered
      await invalidateCacheKey(testKey, { redisClient: simRedis });
      expect(simRedis.store.versions.get(getCacheVersionKey(testKey))).not.toBe(
        "uuid-init-100",
      );
      expect(simRedis.store.data.has(testKey)).toBe(false);

      // 3. Background fetch resolves with stale query results
      resolveBackgroundFetcher([{ id: "stale-from-delayed-bg" }]);
      await bgPromise;
      await new Promise((r) => setTimeout(r, 10));

      // 4. VERIFY: Redis Lua rejected write; Redis store and memory remain free of stale data
      expect(simRedis.store.data.has(testKey)).toBe(false);
      expect(inMemorySWRCache.has(testKey)).toBe(false);
    });

    it("background revalidation interleaving: fails closed if versionKey is evicted during background fetch", async () => {
      const simRedis = createSimulatedRedis();

      // Seed Redis with stale data
      const stalePayload = {
        data: [{ id: "stale-2" }],
        cachedAt: Date.now() - 600 * 1000,
        version: "uuid-init-200",
      };
      simRedis.store.data.set(testKey, JSON.stringify(stalePayload));
      simRedis.store.versions.set(getCacheVersionKey(testKey), "uuid-init-200");

      let resolveBackgroundFetcher: (val: any) => void = () => {};
      const bgPromise = new Promise((resolve) => {
        resolveBackgroundFetcher = resolve;
      });
      const fetcher = jest.fn().mockImplementation(() => bgPromise);

      // 1. Stale hit occurs, background revalidation starts
      const res = await swrCache(testKey, fetcher, { redisClient: simRedis });
      expect(res).toEqual(stalePayload.data);

      await new Promise((r) => setTimeout(r, 10));
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 2. While background fetch is pending, versionKey is evicted
      simRedis.store.versions.delete(getCacheVersionKey(testKey));

      // 3. Background fetch resolves
      resolveBackgroundFetcher([{ id: "stale-evicted-bg" }]);
      await bgPromise;
      await new Promise((r) => setTimeout(r, 10));

      // 4. VERIFY: Redis Lua rejected write because version key was evicted (fails closed)
      const currentStored = JSON.parse(simRedis.store.data.get(testKey)!);
      expect(currentStored.data).toEqual(stalePayload.data);
      expect(currentStored.data).not.toEqual([{ id: "stale-evicted-bg" }]);
      expect(inMemorySWRCache.has(testKey)).toBe(false);
    });

    it("distributed in-memory consistency: Redis GET miss does NOT serve stale local in-memory data after Instance B invalidates Redis", async () => {
      const simRedis = createSimulatedRedis();
      const versionKey = getCacheVersionKey(testKey);

      // 1. Instance A has stale data in its local in-memory cache
      const staleLocalData = [
        { id: "stale-rev", text: "Stale data in Instance A local memory" },
      ];
      inMemorySWRCache.set(testKey, {
        data: staleLocalData,
        cachedAt: Date.now() - 1000,
        version: "old-token",
      });

      // 2. Instance B invalidates Redis (cache key deleted, new generation token in Redis)
      simRedis.store.data.delete(testKey);
      simRedis.store.versions.set(versionKey, "instance-b-fresh-token");

      // 3. Instance A receives a request for the same key with Redis configured
      const freshDbData = [{ id: "fresh-rev", text: "Fresh reviews from DB" }];
      const fetcher = jest.fn().mockResolvedValue(freshDbData);

      const result = await swrCache(testKey, fetcher, {
        redisClient: simRedis,
      });

      // 4. VERIFY:
      // - Instance A must NOT return stale in-memory data
      // - Direct database fetcher MUST be called because Redis had a cache miss
      expect(result).toEqual(freshDbData);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // - Stale in-memory entry in Instance A must NOT be retained
      expect(inMemorySWRCache.has(testKey)).toBe(false);

      // - Redis must now be atomically populated with the fresh data
      expect(simRedis.store.data.has(testKey)).toBe(true);
      const parsed = JSON.parse(simRedis.store.data.get(testKey)!);
      expect(parsed.data).toEqual(freshDbData);
    });
  });

  describe("Strict Atomic Safety (Eval Availability)", () => {
    it("eval unavailable on write: does NOT execute unsafe non-atomic redis.set and fails open safely", async () => {
      const unsafeMockRedis = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue("OK"),
        del: jest.fn().mockResolvedValue(1),
        // eval is intentionally missing / undefined
      };

      const freshData = { id: "fresh-safe", title: "Direct DB" };
      const fetcher = jest.fn().mockResolvedValue(freshData);

      const result = await swrCache(testKey, fetcher, {
        redisClient: unsafeMockRedis,
      });

      // Returns fresh data to caller safely (fail-open)
      expect(result).toEqual(freshData);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Must NOT call unsafe non-atomic redis.set!
      expect(unsafeMockRedis.set).not.toHaveBeenCalled();
    });

    it("eval unavailable on invalidation: does NOT execute unsafe non-atomic redis.del", async () => {
      const unsafeMockRedis = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue("OK"),
        del: jest.fn().mockResolvedValue(1),
        // eval is intentionally missing / undefined
      };

      const result = await invalidateCacheKey(testKey, {
        redisClient: unsafeMockRedis,
      });

      // Returns false indicating Redis invalidation was not possible without eval
      expect(result).toBe(false);

      // Must NOT call unsafe non-atomic redis.del!
      expect(unsafeMockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe("Redis Failure Fallback & Direct Fetch", () => {
    it("calls fetcher directly on Redis GET error and does NOT serve stale in-memory data", async () => {
      // Pre-seed in-memory cache with stale data
      inMemorySWRCache.set(testKey, {
        data: [{ id: "stale-memory", comment: "Stale from memory" }],
        cachedAt: Date.now() - 1000,
      });

      // Redis throws connection timeout error
      mockRedis.get.mockRejectedValue(new Error("Redis connection timed out"));

      // Fresh database fetcher
      const freshDbData = [
        { id: "fresh-from-db", comment: "Direct from Prisma" },
      ];
      const fetcher = jest.fn().mockResolvedValue(freshDbData);

      const result = await swrCache(testKey, fetcher, {
        redisClient: mockRedis,
      });

      // Must return fresh data from fetcher, NOT the stale in-memory data
      expect(result).toEqual(freshDbData);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("returns fetcher data even if Redis eval throws error", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.eval.mockRejectedValue(new Error("Redis readonly / OOM"));
      const fetcher = jest.fn().mockResolvedValue({ status: "saved-in-db" });

      const result = await swrCache(testKey, fetcher, {
        redisClient: mockRedis,
      });

      expect(result).toEqual({ status: "saved-in-db" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("uses in-memory Tier 1 cache when Redis is intentionally unconfigured", async () => {
      const fetcher = jest.fn().mockResolvedValue("unconfigured-db-data");

      // Pass null redisClient (simulating missing UPSTASH env vars)
      const res1 = await swrCache("unconfigured-key", fetcher, {
        redisClient: null,
      });
      expect(res1).toBe("unconfigured-db-data");
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Second call should hit in-memory cache
      const res2 = await swrCache("unconfigured-key", fetcher, {
        redisClient: null,
      });
      expect(res2).toBe("unconfigured-db-data");
      expect(fetcher).toHaveBeenCalledTimes(1); // not called again
    });
  });

  describe("Cache Invalidation", () => {
    it("invalidates venue reviews cache key in Redis atomically and in-memory fallback", async () => {
      const venueId = "venue-abc-123";
      const expectedKey = getVenueReviewsCacheKey(venueId);
      expect(expectedKey).toBe("venue:reviews:venue-abc-123");

      const success = await invalidateVenueReviewsCache(venueId, {
        redisClient: mockRedis,
      });

      expect(success).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        LUA_ATOMIC_INVALIDATE,
        [expectedKey, getCacheVersionKey(expectedKey)],
        [expect.any(String)],
      );
    });

    it("returns false without crashing if Redis eval throws error", async () => {
      mockRedis.eval.mockRejectedValue(new Error("Connection reset"));

      const success = await invalidateCacheKey("some-key", {
        redisClient: mockRedis,
      });

      expect(success).toBe(false);
    });
  });
});
