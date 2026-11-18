import {
  getOrSetVenueAvailability,
  invalidateVenueAvailability,
  venueAvailabilityCacheKey,
} from "../../lib/cache/venueAvailabilityCache";

describe("Venue availability cache", () => {
  test("100 concurrent requests trigger exactly 1 database fetch", async () => {
    let dbQueryCount = 0;

    const mockFetchFromDb = async () => {
      dbQueryCount++;
      await new Promise((resolve) => setTimeout(resolve, 50)); // simulate DB latency
      return { status: "available", timestamp: Date.now() };
    };

    const cacheKey = `test_venue_${Math.random()}`;

    // Fire 100 concurrent requests simultaneously
    const requests = Array.from({ length: 100 }, () =>
      getOrSetVenueAvailability(cacheKey, mockFetchFromDb, 60),
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

  test("invalidates the venue availability cache entry", async () => {
    const venueId = `venue_${Math.random()}`;
    const cacheKey = venueAvailabilityCacheKey(venueId);
    const oldData = { availableDesks: 5 };
    const updatedData = { availableDesks: 4 };

    expect(cacheKey).toBe(`venue:availability:${venueId}`);
    await getOrSetVenueAvailability(cacheKey, async () => oldData, 60);
    await invalidateVenueAvailability(cacheKey);

    await expect(
      getOrSetVenueAvailability(cacheKey, async () => updatedData, 60),
    ).resolves.toEqual(updatedData);
  });

  test("does not repopulate the cache from a fetch invalidated in flight", async () => {
    const cacheKey = venueAvailabilityCacheKey(`venue_${Math.random()}`);
    let resolveOldFetch!: (value: { availableDesks: number }) => void;
    const oldFetch = new Promise<{ availableDesks: number }>((resolve) => {
      resolveOldFetch = resolve;
    });
    const firstRequest = getOrSetVenueAvailability(
      cacheKey,
      () => oldFetch,
      60,
    );

    await invalidateVenueAvailability(cacheKey);
    await expect(
      getOrSetVenueAvailability(
        cacheKey,
        async () => ({ availableDesks: 4 }),
        60,
      ),
    ).resolves.toEqual({ availableDesks: 4 });

    resolveOldFetch({ availableDesks: 5 });
    await firstRequest;

    await expect(
      getOrSetVenueAvailability(
        cacheKey,
        async () => ({ availableDesks: 3 }),
        60,
      ),
    ).resolves.toEqual({ availableDesks: 4 });
  });
});
