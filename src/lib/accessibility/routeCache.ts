import { createHash } from "node:crypto";
import { getRedis } from "@/lib/redis";

/** Entries are served as fresh for 15 minutes. */
export const ROUTE_CACHE_TTL_MS = 15 * 60 * 1000;
/** After the TTL, stale entries are still served while a refresh runs in the background. */
export const ROUTE_CACHE_STALE_MS = 15 * 60 * 1000;
/** Upper bound for the in-memory LRU. */
export const ROUTE_CACHE_MAX_ENTRIES = 500;
/** 5 decimal places is roughly 1m of precision. */
export const ROUTE_CACHE_COORDINATE_PRECISION = 5;

interface CacheEntry {
  value: unknown;
  storedAt: number;
}

export interface RouteCacheKeyInput {
  profile: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  maxAllowedGrade: number;
}

const memoryCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function roundCoordinate(value: number): number {
  // "+ 0" turns -0 into 0 so tiny negative values share a key with 0.
  return Number(value.toFixed(ROUTE_CACHE_COORDINATE_PRECISION)) + 0;
}

export function buildRouteCacheKey(input: RouteCacheKeyInput): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        profile: input.profile,
        start: [roundCoordinate(input.start.lat), roundCoordinate(input.start.lng)],
        end: [roundCoordinate(input.end.lat), roundCoordinate(input.end.lng)],
        maxAllowedGrade: input.maxAllowedGrade,
      }),
    )
    .digest("hex");
  return `accessibility:route:v2:${digest}`;
}

function isExpired(entry: CacheEntry, now: number): boolean {
  return now - entry.storedAt >= ROUTE_CACHE_TTL_MS + ROUTE_CACHE_STALE_MS;
}

function readMemory(key: string, now: number): CacheEntry | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (isExpired(entry, now)) {
    memoryCache.delete(key);
    return null;
  }
  // Re-insert to mark as most recently used.
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry;
}

function writeMemory(key: string, entry: CacheEntry): void {
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  while (memoryCache.size > ROUTE_CACHE_MAX_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

async function readRedis(key: string, now: number): Promise<CacheEntry | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const entry = await redis.get<CacheEntry>(key);
    if (!entry || typeof entry.storedAt !== "number" || isExpired(entry, now)) {
      return null;
    }
    return entry;
  } catch (error) {
    console.warn("[Accessibility] Redis route-cache read failed:", error);
    return null;
  }
}

async function writeRedis(key: string, entry: CacheEntry): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, entry, {
      ex: Math.ceil((ROUTE_CACHE_TTL_MS + ROUTE_CACHE_STALE_MS) / 1000),
    });
  } catch (error) {
    console.warn("[Accessibility] Redis route-cache write failed:", error);
  }
}

function refresh<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const request = (async () => {
    const value = await fetcher();
    const entry: CacheEntry = { value, storedAt: Date.now() };
    writeMemory(key, entry);
    await writeRedis(key, entry);
    return value;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, request);
  return request;
}

/**
 * Stale-while-revalidate cache for upstream routing calls.
 * - fresh entry (under 15 min): returned without any upstream call
 * - stale entry (15 to 30 min): returned immediately, refreshed in the background
 * - missing or expired: fetched once, concurrent callers share the same request
 */
export async function getOrRefreshRoute<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  let entry = readMemory(key, now);
  if (!entry) {
    entry = await readRedis(key, now);
    if (entry) writeMemory(key, entry);
  }

  if (entry) {
    const age = now - entry.storedAt;
    if (age < ROUTE_CACHE_TTL_MS) return entry.value as T;
    refresh(key, fetcher).catch((error) => {
      console.warn("[Accessibility] Background route revalidation failed:", error);
    });
    return entry.value as T;
  }

  return refresh(key, fetcher);
}

/** Test helper: drops all in-memory entries and in-flight requests. */
export function clearRouteCache(): void {
  memoryCache.clear();
  inflight.clear();
}
