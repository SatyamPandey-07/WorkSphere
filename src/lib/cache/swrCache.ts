/**
 * Multi-tier Stale-While-Revalidate (SWR) Redis Cache Utility.
 *
 * Wraps Upstash Redis client with:
 * - Fresh TTL (default 300s / 5m)
 * - Maximum stale window (default 3600s / 1h)
 * - Immediate stale response + background async revalidation
 * - In-flight revalidation deduplication
 * - Distributed cryptographically secure UUID generation tokens via Redis Lua scripting
 *   (strictly captures generation token BEFORE fetch starts, never reuses old tokens across
 *    distributed server instances, and fails closed if generation key was evicted or missing)
 * - Strict atomic safety: never bypasses atomicity with unsafe redis.set/redis.del fallbacks
 * - Promise identity check in finally block to prevent deleting newer in-flight promises
 * - Direct database/fetcher fallback on Redis connection error (bypassing stale memory cache)
 * - In-memory Tier 1 cache for unconfigured Redis environments
 *
 * Issue #7266
 */

import { randomUUID } from "crypto";
import { getRedis } from "@/lib/redis";

export const DEFAULT_FRESH_TTL_SECONDS = 300; // 5 minutes
export const DEFAULT_STALE_TTL_SECONDS = 3600; // 1 hour

/**
 * Generates a cryptographically secure, globally unique generation token.
 * Independent of system clocks, immune to multi-instance clock skew.
 */
export function generateGenerationToken(): string {
  return randomUUID();
}

/**
 * Lua script for atomic generation initialization/retrieval in Redis.
 * If the version key exists, returns it.
 * If it does not exist (first access or evicted), initializes it with the unique UUID token via SET NX.
 *
 * KEYS[1]: Version key (e.g. venue:reviews:123:version)
 * ARGV[1]: Fresh crypto UUID generation token
 */
export const LUA_ATOMIC_GET_OR_INIT_VERSION = `
local ver = redis.call('GET', KEYS[1])
if not ver then
  redis.call('SET', KEYS[1], ARGV[1], 'NX')
  ver = redis.call('GET', KEYS[1])
end
return tostring(ver)
`;

/**
 * Lua script for atomic cache invalidation in Redis.
 * Atomically updates the generation token to a fresh crypto UUID and deletes the cached data key.
 *
 * KEYS[1]: Cache key (e.g. venue:reviews:123)
 * KEYS[2]: Version key (e.g. venue:reviews:123:version)
 * ARGV[1]: Fresh crypto UUID generation token
 */
export const LUA_ATOMIC_INVALIDATE = `
redis.call('SET', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[1])
return ARGV[1]
`;

/**
 * Lua script for atomic conditional write in Redis.
 * Verifies that the generation token in Redis strictly matches the expected token captured BEFORE fetch.
 * If the version key does not exist (evicted/missing), it FAILS CLOSED and returns 0.
 * If matched: updates the cache key with TTL and returns 1.
 * If mismatched (invalidation occurred concurrently): aborts write and returns 0.
 *
 * KEYS[1]: Cache key (e.g. venue:reviews:123)
 * KEYS[2]: Version key (e.g. venue:reviews:123:version)
 * ARGV[1]: Expected generation token (captured BEFORE fetch)
 * ARGV[2]: Serialized envelope JSON
 * ARGV[3]: Stale TTL in seconds
 */
export const LUA_ATOMIC_SET_IF_VERSION_MATCH = `
local currentVer = redis.call('GET', KEYS[2])
if not currentVer then
  return 0
end
if tostring(currentVer) == tostring(ARGV[1]) then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
else
  return 0
end
`;

export interface SWREntry<T> {
  data: T;
  cachedAt: number; // millisecond timestamp
  version?: string | number;
}

export interface SWROptions {
  freshTtlSeconds?: number;
  staleTtlSeconds?: number;
  redisClient?: any;
}

// In-flight mutex map to deduplicate concurrent background revalidations for the same key
export const inFlightRevalidations = new Map<string, Promise<void>>();

// In-memory fallback map for environments or test suites without active Redis connection
export const inMemorySWRCache = new Map<string, SWREntry<any>>();

// Process-local key generation counters as fast-path guard
export const keyVersions = new Map<string, number>();

/**
 * Returns the current local version token for a cache key.
 */
export function getKeyVersion(key: string): number {
  return keyVersions.get(key) ?? 0;
}

/**
 * Increments and returns the next local version token for a cache key.
 */
export function bumpKeyVersion(key: string): number {
  const next = (keyVersions.get(key) ?? 0) + 1;
  keyVersions.set(key, next);
  return next;
}

/**
 * Standardized Redis version key name for atomic generation checks.
 */
export function getCacheVersionKey(key: string): string {
  return `${key}:version`;
}

/**
 * Generates the standardized Redis cache key for venue amenity reviews.
 */
export function getVenueReviewsCacheKey(venueId: string): string {
  return `venue:reviews:${venueId}`;
}

/**
 * Atomically reads or initializes the persistent generation token in Redis.
 * Uses cryptographically secure UUID tokens so that even if a version key was evicted,
 * subsequent reinitializations always produce unique tokens that never match old in-flight tokens.
 */
export async function getOrInitRedisVersion(
  redis: any,
  versionKey: string,
): Promise<string | null> {
  if (!redis || typeof redis.eval !== "function") {
    return null;
  }
  try {
    const token = generateGenerationToken();
    const ver = await redis.eval(
      LUA_ATOMIC_GET_OR_INIT_VERSION,
      [versionKey],
      [token],
    );
    return ver !== null && ver !== undefined ? String(ver) : null;
  } catch (err) {
    console.error(
      `[swrCache] Failed to get or init Redis version for '${versionKey}':`,
      err,
    );
    return null;
  }
}

/**
 * Triggers background revalidation without blocking the caller.
 * Deduplicates in-flight revalidations for the same key.
 * Strictly captures the Redis generation token BEFORE invoking the background fetcher.
 */
export function triggerBackgroundRevalidation<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: SWROptions,
): Promise<void> {
  const existing = inFlightRevalidations.get(key);
  if (existing) {
    return existing;
  }

  const staleTtlSeconds = options?.staleTtlSeconds ?? DEFAULT_STALE_TTL_SECONDS;
  const redis = options?.redisClient ?? getRedis();
  const versionKey = getCacheVersionKey(key);

  // Capture process-local version before executing the fetcher
  const localVersion = bumpKeyVersion(key);

  let promise: Promise<void> | null = null;
  promise = (async () => {
    try {
      // ORDERING REQUIREMENT:
      // Strictly capture remote Redis generation token BEFORE executing fetcher
      const remoteVersion = await getOrInitRedisVersion(redis, versionKey);

      // Now execute the background fetcher
      const freshData = await fetcher();

      // Fast-path Invalidation Guard:
      // If the cache key was invalidated in this process while fetch was in-flight, abort.
      if (keyVersions.get(key) !== localVersion) {
        return;
      }

      const envelope: SWREntry<T> = {
        data: freshData,
        cachedAt: Date.now(),
        version: remoteVersion ?? localVersion,
      };

      let writeSucceeded = false;
      if (redis) {
        if (typeof redis.eval === "function") {
          if (remoteVersion !== null) {
            try {
              const res = await redis.eval(
                LUA_ATOMIC_SET_IF_VERSION_MATCH,
                [key, versionKey],
                [
                  String(remoteVersion),
                  JSON.stringify(envelope),
                  String(staleTtlSeconds),
                ],
              );
              if (res === 1) {
                writeSucceeded = true;
              }
            } catch (err) {
              console.error(
                `[swrCache] Background Redis atomic set failed for key '${key}':`,
                err,
              );
            }
          }
        } else {
          console.warn(
            `[swrCache] Configured Redis client does not support 'eval'; skipping non-atomic background write for key '${key}'.`,
          );
        }
      } else {
        // Redis unconfigured: in-memory tier is active
        writeSucceeded = true;
      }

      // Only update in-memory cache when Redis is unconfigured and no local invalidation happened
      if (writeSucceeded && keyVersions.get(key) === localVersion) {
        if (!redis) {
          inMemorySWRCache.set(key, envelope);
        }
      }
    } catch (err) {
      console.error(
        `[swrCache] Background revalidation fetcher failed for key '${key}':`,
        err,
      );
    } finally {
      // Identity check: only delete if the Map still holds this exact promise
      if (inFlightRevalidations.get(key) === promise) {
        inFlightRevalidations.delete(key);
      }
    }
  })();

  inFlightRevalidations.set(key, promise);
  return promise;
}

/**
 * Generic Stale-While-Revalidate (SWR) cache executor.
 *
 * 1. Checks Redis client.
 *    - If Redis is configured, serves from Redis directly and bypasses local in-memory cache to guarantee
 *      consistency across multi-instance deployments.
 *    - If Redis throws an error, bypasses in-memory cache and calls fetcher directly (fail-open).
 * 2. If Redis is unconfigured (null), uses in-memory Tier 1 cache.
 * 3. Fresh Hit (age < freshTtl): returns immediately (< 30ms).
 * 4. Stale Hit (freshTtl <= age < staleTtl): returns cached data immediately
 *    and fires an async background revalidation protected by atomic generation tokens.
 * 5. Miss / Expired (age >= staleTtl or no cache): strictly captures Redis generation
 *    token BEFORE fetcher, executes fetcher, and atomically populates Redis via Lua script.
 */
export async function swrCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: SWROptions,
): Promise<T> {
  const freshTtlSeconds = options?.freshTtlSeconds ?? DEFAULT_FRESH_TTL_SECONDS;
  const staleTtlSeconds = options?.staleTtlSeconds ?? DEFAULT_STALE_TTL_SECONDS;
  const redis = options?.redisClient ?? getRedis();
  const versionKey = getCacheVersionKey(key);

  let entry: SWREntry<T> | null = null;
  let redisError = false;

  // 1. Attempt to read from Redis
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw !== null && raw !== undefined) {
        if (typeof raw === "string") {
          try {
            entry = JSON.parse(raw);
          } catch {
            entry = null;
          }
        } else if (typeof raw === "object") {
          entry = raw as SWREntry<T>;
        }
      } else {
        // Cache miss in Redis: ensure local memory does not hold stale data
        inMemorySWRCache.delete(key);
      }
    } catch (err) {
      redisError = true;
      console.error(`[swrCache] Redis get failed for key '${key}':`, err);
    }
  }

  // 2. Fail-Open direct database fallback:
  // If Redis connection/query failed, do NOT serve stale in-memory data.
  // Execute fetcher directly from the database.
  if (redisError) {
    return await fetcher();
  }

  // 3. In-memory Tier 1 cache is ONLY used when Redis is intentionally unconfigured (no client).
  // When Redis is configured, local memory cache is bypassed to guarantee distributed consistency
  // across multi-instance deployments (avoiding stale reads after Redis invalidation by another instance).
  if (!redis && !entry && inMemorySWRCache.has(key)) {
    entry = inMemorySWRCache.get(key) as SWREntry<T>;
  }

  // 4. Evaluate cached entry freshness
  if (entry && typeof entry.cachedAt === "number" && "data" in entry) {
    const ageSeconds = (Date.now() - entry.cachedAt) / 1000;

    // Fresh Hit: Return cached data immediately
    if (ageSeconds < freshTtlSeconds) {
      return entry.data;
    }

    // Stale Hit: Return cached data immediately, trigger background revalidation
    if (ageSeconds < staleTtlSeconds) {
      triggerBackgroundRevalidation(key, fetcher, options);
      return entry.data;
    }
  }

  // 5. Cache Miss or Expired past stale window:
  const localVersion = bumpKeyVersion(key);

  // ORDERING REQUIREMENT:
  // Strictly capture remote Redis generation token BEFORE executing the fetcher
  const remoteVersion = await getOrInitRedisVersion(redis, versionKey);

  // Execute fetcher from database
  const freshData = await fetcher();

  const envelope: SWREntry<T> = {
    data: freshData,
    cachedAt: Date.now(),
    version: remoteVersion ?? localVersion,
  };

  // 6. Populate Redis & in-memory cache ONLY if atomic generation check passes
  let writeSucceeded = false;
  if (keyVersions.get(key) === localVersion) {
    if (redis) {
      if (typeof redis.eval === "function") {
        if (remoteVersion !== null) {
          try {
            const res = await redis.eval(
              LUA_ATOMIC_SET_IF_VERSION_MATCH,
              [key, versionKey],
              [
                String(remoteVersion),
                JSON.stringify(envelope),
                String(staleTtlSeconds),
              ],
            );
            if (res === 1) {
              writeSucceeded = true;
            }
          } catch (err) {
            console.error(
              `[swrCache] Redis atomic set failed for key '${key}':`,
              err,
            );
          }
        }
      } else {
        console.warn(
          `[swrCache] Configured Redis client does not support 'eval'; skipping non-atomic cache write for key '${key}'.`,
        );
      }
    } else {
      // Redis unconfigured: in-memory tier is active
      writeSucceeded = true;
    }

    if (writeSucceeded && keyVersions.get(key) === localVersion) {
      if (!redis) {
        inMemorySWRCache.set(key, envelope);
      }
    }
  }

  return freshData;
}

/**
 * Invalidates the Redis cache key for a venue's reviews.
 * Cleans up Redis, in-memory caches, and atomically sets a new UUID generation token.
 */
export async function invalidateVenueReviewsCache(
  venueId: string,
  options?: { redisClient?: any },
): Promise<boolean> {
  const key = getVenueReviewsCacheKey(venueId);
  return invalidateCacheKey(key, options);
}

/**
 * Invalidates an arbitrary cache key in Redis and in-memory fallback.
 * Atomically sets a new unique crypto UUID generation token and deletes cache key so that
 * any in-flight background or synchronous fetches across all server instances are discarded.
 * Strictly avoids non-atomic fallbacks if eval is unavailable on configured Redis.
 */
export async function invalidateCacheKey(
  key: string,
  options?: { redisClient?: any },
): Promise<boolean> {
  const versionKey = getCacheVersionKey(key);

  // Invalidate process-local version token to abort any in-flight background revalidations in this process
  bumpKeyVersion(key);
  inMemorySWRCache.delete(key);
  inFlightRevalidations.delete(key);

  const redis = options?.redisClient ?? getRedis();
  if (redis) {
    if (typeof redis.eval !== "function") {
      console.warn(
        `[swrCache] Configured Redis client does not support 'eval'; skipping non-atomic invalidation for key '${key}'.`,
      );
      return false;
    }
    try {
      const newToken = generateGenerationToken();
      await redis.eval(LUA_ATOMIC_INVALIDATE, [key, versionKey], [newToken]);
      return true;
    } catch (err) {
      console.error(
        `[swrCache] Redis atomic invalidation failed for key '${key}':`,
        err,
      );
      return false;
    }
  }

  return true;
}

/**
 * Clears the in-memory fallback cache and resets version tokens (for test suites).
 */
export function clearMemorySWRCache(): void {
  inMemorySWRCache.clear();
  inFlightRevalidations.clear();
  keyVersions.clear();
}
