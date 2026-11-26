import {
  cacheVenueDetails,
  type CachedVenueRecord,
  type VenueStoreAdapter,
} from '@/lib/storage/venueCacheStorage';

function createMockVenueStore(
  initial: CachedVenueRecord<{ name: string; floorPlan?: string }>[],
  failUntilEvictedCount: number
) {
  const map = new Map<string, CachedVenueRecord<{ name: string; floorPlan?: string }>>();
  for (const item of initial) {
    map.set(item.venueId, { ...item });
  }
  let evictedTotal = 0;
  let putAttempts = 0;

  const store: VenueStoreAdapter<{ name: string; floorPlan?: string }> = {
    async put(record) {
      putAttempts += 1;
      if (putAttempts === 1 && evictedTotal < failUntilEvictedCount) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(record.venueId, { ...record });
    },
    async getAll() {
      return Array.from(map.values()).map((v) => ({ ...v }));
    },
    async delete(venueId) {
      if (map.delete(venueId)) {
        evictedTotal += 1;
      }
    },
  };

  return {
    store,
    map,
    getPutAttempts: () => putAttempts,
  };
}

describe('cacheVenueDetails QuotaExceededError LRU eviction and retry', () => {
  it('evicts least-recently-used venues and retries write once on QuotaExceededError', async () => {
    const { store, map, getPutAttempts } = createMockVenueStore(
      [
        {
          venueId: 'venue-old',
          data: { name: 'Oldest Hub' },
          lastAccessedAt: 1_000,
          cachedAt: 900,
        },
        {
          venueId: 'venue-mid',
          data: { name: 'Mid Hub' },
          lastAccessedAt: 2_000,
          cachedAt: 1_500,
        },
        {
          venueId: 'venue-recent',
          data: { name: 'Recent Hub' },
          lastAccessedAt: 5_000,
          cachedAt: 4_500,
        },
      ],
      2
    );

    const res = await cacheVenueDetails(
      store,
      'venue-floorplan-new',
      { name: 'Bhandup West Studio', floorPlan: 'large-svg-data' },
      { evictBatchSize: 2, now: () => 6_000 }
    );

    expect(res).toEqual({
      ok: true,
      evictedCount: 2,
      retried: true,
    });
    expect(getPutAttempts()).toBe(2);
    expect(map.has('venue-old')).toBe(false);
    expect(map.has('venue-mid')).toBe(false);
    expect(map.has('venue-recent')).toBe(true);
    expect(map.has('venue-floorplan-new')).toBe(true);
  });

  it('returns a handled failure without unhandled rejection when quota still fails after retry', async () => {
    const { store, getPutAttempts } = createMockVenueStore(
      [
        {
          venueId: 'venue-stale-1',
          data: { name: 'Stale 1' },
          lastAccessedAt: 1_000,
          cachedAt: 1_000,
        },
      ],
      99
    );

    const res = await cacheVenueDetails(store, 'venue-huge', {
      name: 'Oversized Floorplan',
    });

    expect(res.ok).toBe(false);
    expect(res.retried).toBe(true);
    expect(res.evictedCount).toBe(1);
    expect(getPutAttempts()).toBe(2);
  });
});