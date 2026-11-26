export interface CachedVenueRecord<TVenue = Record<string, unknown>> {
  venueId: string;
  data: TVenue;
  floorPlanBytes?: number;
  lastAccessedAt: number;
  cachedAt: number;
}

export interface VenueStoreAdapter<TVenue = Record<string, unknown>> {
  put(record: CachedVenueRecord<TVenue>): Promise<void> | void;
  getAll(): Promise<CachedVenueRecord<TVenue>[]> | CachedVenueRecord<TVenue>[];
  delete(venueId: string): Promise<void> | void;
}

export interface CacheVenueDetailsOptions {
  evictBatchSize?: number;
  now?: () => number;
}

export interface CacheVenueResult {
  ok: boolean;
  evictedCount: number;
  retried: boolean;
  error?: string;
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  return (
    e.name === 'QuotaExceededError' ||
    e.code === 22 ||
    e.code === 1014 ||
    (e.message ?? '').toLowerCase().includes('quotaexceedederror') ||
    (e.message ?? '').toLowerCase().includes('exceeded the quota')
  );
}

export async function cacheVenueDetails<TVenue = Record<string, unknown>>(
  store: VenueStoreAdapter<TVenue>,
  venueId: string,
  data: TVenue,
  options: CacheVenueDetailsOptions = {}
): Promise<CacheVenueResult> {
  const now = options.now ?? (() => Date.now());
  const evictBatchSize = Math.max(1, options.evictBatchSize ?? 3);
  const ts = now();

  const record: CachedVenueRecord<TVenue> = {
    venueId,
    data,
    lastAccessedAt: ts,
    cachedAt: ts,
  };

  try {
    await store.put(record);
    return { ok: true, evictedCount: 0, retried: false };
  } catch (firstErr) {
    if (!isQuotaExceededError(firstErr)) {
      throw firstErr;
    }

    const allRecords = await store.getAll();
    const candidates = allRecords
      .filter((item) => item.venueId !== venueId)
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    if (candidates.length === 0) {
      return {
        ok: false,
        evictedCount: 0,
        retried: true,
        error: 'IndexedDB quota exceeded and no stale venues available to evict',
      };
    }

    let evictedCount = 0;
    for (const stale of candidates.slice(0, evictBatchSize)) {
      await store.delete(stale.venueId);
      evictedCount += 1;
    }

    try {
      await store.put({
        ...record,
        lastAccessedAt: now(),
      });
      return { ok: true, evictedCount, retried: true };
    } catch (retryErr) {
      if (isQuotaExceededError(retryErr)) {
        return {
          ok: false,
          evictedCount,
          retried: true,
          error: 'IndexedDB quota still exceeded after LRU eviction retry',
        };
      }
      throw retryErr;
    }
  }
}