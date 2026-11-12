import { getOrSetVenueAvailability } from '../../lib/cache/venueAvailabilityCache';

describe('Cache Stampede Protection (XFetch & Single-Flight)', () => {
  test('100 concurrent requests trigger exactly 1 database fetch', async () => {
    let dbQueryCount = 0;

    const mockFetchFromDb = async () => {
      dbQueryCount++;
      await new Promise((resolve) => setTimeout(resolve, 50)); // simulate DB latency
      return { status: 'available', timestamp: Date.now() };
    };

    const cacheKey = `test_venue_${Math.random()}`;

    // Fire 100 concurrent requests simultaneously
    const requests = Array.from({ length: 100 }, () =>
      getOrSetVenueAvailability(cacheKey, mockFetchFromDb, 60)
    );

    const startTime = performance.now();
    const results = await Promise.all(requests);
    const duration = performance.now() - startTime;

    // Verify all 100 requests received identical valid data
    expect(results.length).toBe(100);
    for (const res of results) {
      expect(res).toEqual(results[0]);
    }

    // Verify single-flight deduplication: exactly 1 DB query executed
    expect(dbQueryCount).toBe(1);

    // Verify response latency remains exceptionally fast
    expect(duration).toBeLessThan(100); // 50ms DB + negligible JS overhead
  });
});