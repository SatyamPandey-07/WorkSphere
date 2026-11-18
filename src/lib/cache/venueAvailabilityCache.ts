import { createHash } from "crypto";
import { getRedis } from "@/lib/redis";
import {
  bumpKeyVersion,
  generateGenerationToken,
  getCacheVersionKey,
  inMemorySWRCache,
  swrCache,
} from "@/lib/cache/swrCache";

export type VenueAvailabilityCacheParams = {
  date: string;
  time: string;
  duration: number;
  timeZone: string;
};

const localGenerations = new Map<string, number>();
const inFlightAvailability = new Map<string, Promise<unknown>>();
const localCacheKeysByScope = new Map<string, Set<string>>();
const bypassRedisCache = new Set<string>();

export function venueAvailabilityCacheKey(
  venueId: string,
  params?: VenueAvailabilityCacheParams,
): string {
  const key = `venue:availability:${venueId}`;
  if (!params) {
    return key;
  }

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        params.date,
        params.time,
        params.duration,
        params.timeZone,
      ]),
    )
    .digest("hex");
  return `${key}:${fingerprint}`;
}

/**
 * Redis generations are shared across instances; without Redis, invalidation
 * is process-local and the in-memory cache is used as a development fallback.
 */
async function getGeneration(scopeKey: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) {
    bypassRedisCache.delete(scopeKey);
    return String(localGenerations.get(scopeKey) ?? 0);
  }
  if (bypassRedisCache.has(scopeKey)) {
    return null;
  }

  try {
    const versionKey = getCacheVersionKey(scopeKey);
    let generation = await redis.get(versionKey);
    if (generation === null || generation === undefined) {
      await redis.set(versionKey, generateGenerationToken(), { nx: true });
      generation = await redis.get(versionKey);
    }
    return generation === null || generation === undefined
      ? null
      : String(generation);
  } catch (error) {
    console.error(
      `[venueAvailabilityCache] Failed to read Redis generation for '${scopeKey}'; bypassing cache:`,
      error,
    );
    return null;
  }
}

export async function getOrSetVenueAvailability<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlSeconds = 60,
  scopeKey = cacheKey,
): Promise<T> {
  let generation = await getGeneration(scopeKey);
  if (generation === null) {
    return fetcher();
  }

  while (true) {
    const versionedKey = `${cacheKey}:generation:${generation}`;
    if (!getRedis()) {
      const localKeys =
        localCacheKeysByScope.get(scopeKey) ?? new Set<string>();
      localKeys.add(versionedKey);
      localCacheKeysByScope.set(scopeKey, localKeys);
    }

    let pending = inFlightAvailability.get(versionedKey) as
      Promise<T> | undefined;
    if (!pending) {
      const cachePromise = swrCache(versionedKey, fetcher, {
        freshTtlSeconds: ttlSeconds,
        staleTtlSeconds: ttlSeconds,
      }).finally(() => {
        if (inFlightAvailability.get(versionedKey) === cachePromise) {
          inFlightAvailability.delete(versionedKey);
        }
      });
      pending = cachePromise;
      inFlightAvailability.set(versionedKey, pending);
    }

    const result = await pending;
    const latestGeneration = await getGeneration(scopeKey);
    if (latestGeneration === null) {
      return fetcher();
    }
    if (latestGeneration === generation) {
      return result;
    }
    generation = latestGeneration;
  }
}

export async function invalidateVenueAvailability(
  scopeKey: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    localGenerations.set(scopeKey, (localGenerations.get(scopeKey) ?? 0) + 1);
    for (const cacheKey of localCacheKeysByScope.get(scopeKey) ?? []) {
      bumpKeyVersion(cacheKey);
      inMemorySWRCache.delete(cacheKey);
      inFlightAvailability.delete(cacheKey);
    }
    localCacheKeysByScope.delete(scopeKey);
    return true;
  }

  if (typeof redis.set !== "function") {
    bypassRedisCache.add(scopeKey);
    console.error(
      `[venueAvailabilityCache] Redis client cannot rotate the generation for '${scopeKey}'; venue availability cache is bypassed for this process.`,
    );
    return false;
  }

  try {
    await redis.set(getCacheVersionKey(scopeKey), generateGenerationToken());
    bypassRedisCache.delete(scopeKey);
    return true;
  } catch (error) {
    bypassRedisCache.add(scopeKey);
    console.error(
      `[venueAvailabilityCache] Redis generation rotation failed for '${scopeKey}'; venue availability cache is bypassed for this process:`,
      error,
    );
    return false;
  }
}
