/**
 * Tests for venue booking data caching strategy utilities.
 */

interface CacheEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  ttlMs: number;
  hitCount: number;
}

function isExpired<T>(entry: CacheEntry<T>, nowMs: number): boolean {
  return nowMs - entry.createdAt > entry.ttlMs;
}

function remainingTtlMs<T>(entry: CacheEntry<T>, nowMs: number): number {
  return Math.max(0, entry.ttlMs - (nowMs - entry.createdAt));
}

function cacheHitRate(hits: number, misses: number): number {
  const total = hits + misses;
  if (total === 0) return 0;
  return Math.round((hits / total) * 100);
}

function evictExpired<T>(entries: CacheEntry<T>[], nowMs: number): CacheEntry<T>[] {
  return entries.filter((e) => !isExpired(e, nowMs));
}

function lruEvict<T>(entries: CacheEntry<T>[], maxEntries: number): CacheEntry<T>[] {
  if (entries.length <= maxEntries) return entries;
  // Sort by hitCount ascending (least recently used approximation), remove lowest
  return [...entries]
    .sort((a, b) => a.hitCount - b.hitCount)
    .slice(entries.length - maxEntries);
}

function mostFrequentKeys<T>(entries: CacheEntry<T>[], limit = 3): string[] {
  return [...entries]
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, limit)
    .map((e) => e.key);
}

const NOW = 1_700_000_000_000;
const ENTRIES: CacheEntry<string>[] = [
  { key: "venue:v1",    value: "data1", createdAt: NOW - 5000,   ttlMs: 60_000, hitCount: 50 },
  { key: "venue:v2",    value: "data2", createdAt: NOW - 70_000, ttlMs: 60_000, hitCount: 2 },
  { key: "bookings:b1", value: "data3", createdAt: NOW - 1000,   ttlMs: 30_000, hitCount: 10 },
];

describe("Caching strategy utilities", () => {
  it("isExpired: entry with 70s age, 60s TTL → expired", () => {
    expect(isExpired(ENTRIES[1], NOW)).toBe(true);
  });

  it("isExpired: fresh entry → not expired", () => {
    expect(isExpired(ENTRIES[0], NOW)).toBe(false);
  });

  it("remainingTtlMs: 60s - 5s used = 55s", () => {
    expect(remainingTtlMs(ENTRIES[0], NOW)).toBe(55_000);
  });

  it("cacheHitRate: 80 hits, 20 misses = 80%", () => {
    expect(cacheHitRate(80, 20)).toBe(80);
  });

  it("evictExpired: removes expired entry", () => {
    const after = evictExpired(ENTRIES, NOW);
    expect(after.length).toBe(2);
    expect(after.every((e) => !isExpired(e, NOW))).toBe(true);
  });

  it("mostFrequentKeys: venue:v1 has most hits", () => {
    expect(mostFrequentKeys(ENTRIES)[0]).toBe("venue:v1");
  });
});
