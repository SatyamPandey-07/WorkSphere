import { getAnalyticsSummaryAsync } from "@/lib/analytics";
import { getAdminSystemMetrics } from "@/lib/adminSystemMetrics";
import {
  _resetHybridVenueSearchStateForTesting,
  getHybridVenueSearchCacheMetrics,
  getTrendingVenueSearchQueries,
  MAX_CONCURRENT_TRENDING_SEARCH_REFRESHES,
  prefetchTrendingVenueSearches,
  searchVenuesWithRrf,
} from "@/lib/search/hybridVenueSearch";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import {
  clearMemorySWRCache,
  inFlightRevalidations,
  inMemorySWRCache,
} from "@/lib/cache/swrCache";

jest.mock("@/lib/analytics", () => ({
  getAnalyticsSummaryAsync: jest.fn(),
}));

jest.mock("@/lib/dbTelemetry", () => ({
  getDbLatencyStats: jest.fn().mockResolvedValue({ totalQueryCount: 0 }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    venueRating: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn().mockReturnValue(null),
}));

function event(query: unknown, timestamp = Date.now()) {
  return {
    name: "search_performed",
    properties: { query },
    timestamp,
  };
}

function queryRows(id = "venue-1") {
  return [
    {
      id,
      score: 0.25,
      needs_embedding: false,
      search_document: "quiet cafe",
    },
  ];
}

async function flushBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("hybrid venue search cache and prefetch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearMemorySWRCache();
    _resetHybridVenueSearchStateForTesting();
    (getRedis as jest.Mock).mockReturnValue(null);
    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValue({
      recentEvents: [],
    });
    (prisma.$queryRaw as jest.Mock).mockResolvedValue(queryRows());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("selects the top ten recent queries using normalized query counts", async () => {
    const now = Date.now();
    const events = [
      event(" Coffee ", now - 20),
      event("coffee", now - 10),
      event("tea", now - 5),
      event("tea", now - 4),
      event("old query", now - 8 * 24 * 60 * 60 * 1000),
      event("future query", now + 100),
      ...Array.from({ length: 10 }, (_, index) =>
        event(`query ${index}`, now - index),
      ),
    ];
    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValue({
      recentEvents: events,
    });

    const trending = await getTrendingVenueSearchQueries(10, now);

    expect(trending).toHaveLength(10);
    expect(trending.map(({ query }) => query)).toEqual([
      "tea",
      "coffee",
      "query 0",
      "query 1",
      "query 2",
      "query 3",
      "query 4",
      "query 5",
      "query 6",
      "query 7",
    ]);
    expect(trending.slice(0, 2).map(({ count }) => count)).toEqual([2, 2]);
  });

  it("handles absent, empty, malformed, and unavailable telemetry safely", async () => {
    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValueOnce(undefined);
    await expect(getTrendingVenueSearchQueries()).resolves.toEqual([]);

    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValueOnce({
      recentEvents: [
        null,
        event(" "),
        event(42),
        { name: "search_performed", properties: { query: "missing time" } },
        { ...event("bad time"), timestamp: Number.NaN },
        {
          name: "venue_viewed",
          properties: { query: "not a search" },
          timestamp: Date.now(),
        },
      ],
    });
    await expect(getTrendingVenueSearchQueries()).resolves.toEqual([]);

    (getAnalyticsSummaryAsync as jest.Mock).mockRejectedValueOnce(
      new Error("telemetry unavailable"),
    );
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getTrendingVenueSearchQueries()).resolves.toEqual([]);
  });

  it("uses separate cache entries for different amenity filters", async () => {
    await searchVenuesWithRrf("quiet cafe", { amenities: ["quiet"] });
    await searchVenuesWithRrf("quiet cafe", { amenities: ["standing desk"] });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("shares a cache entry for the same amenities in a different order or case", async () => {
    await searchVenuesWithRrf("quiet cafe", { amenities: ["Quiet", "wifi"] });
    await searchVenuesWithRrf("quiet cafe", { amenities: [" wifi", "quiet "] });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("normalizes equivalent queries to a single cache entry and reports user metrics", async () => {
    await searchVenuesWithRrf(" Quiet   Cafe ");
    await searchVenuesWithRrf("quiet cafe");

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(getHybridVenueSearchCacheMetrics()).toEqual({
      requests: 2,
      hits: 1,
      misses: 1,
      hitRatio: 0.5,
    });
  });

  it("uses distinct cache entries for every result-affecting search input", async () => {
    const variants: Array<{
      filters: Parameters<typeof searchVenuesWithRrf>[1];
      candidateLimit?: number;
    }> = [
      { filters: { minLat: 1 } },
      { filters: { maxLat: 1 } },
      { filters: { minLng: 1 } },
      { filters: { maxLng: 1 } },
      { filters: { category: "CAFE" } },
      { filters: { cities: ["Seattle"] } },
      { filters: { semanticWeight: 0.8 } },
      { filters: { fullTextWeight: 0.8 } },
      { filters: { rrfK: 20 } },
      { filters: { queryEmbedding: [1, 0] } },
      { filters: { queryEmbedding: [0, 1] } },
      { filters: { enableFuzzyFallback: false } },
      { filters: { minSimilarity: 0.4 } },
      { filters: { semanticConfidenceThreshold: 0.8 } },
      { filters: {}, candidateLimit: 25 },
    ];

    await searchVenuesWithRrf("cache key filters");
    for (const { filters, candidateLimit } of variants) {
      await searchVenuesWithRrf("cache key filters", filters, candidateLimit);
    }

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(variants.length + 1);
    await searchVenuesWithRrf("cache key filters");
    for (const { filters, candidateLimit } of variants) {
      await searchVenuesWithRrf("cache key filters", filters, candidateLimit);
    }
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(variants.length + 1);
  });

  it("reports a finite zero hit ratio before any requests", () => {
    expect(getHybridVenueSearchCacheMetrics()).toEqual({
      requests: 0,
      hits: 0,
      misses: 0,
      hitRatio: 0,
    });
  });

  it("deduplicates concurrent cache misses for the same normalized query", async () => {
    let resolveQuery: (rows: unknown[]) => void = () => {};
    (prisma.$queryRaw as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );

    const first = searchVenuesWithRrf(" Quiet   Cafe ");
    const second = searchVenuesWithRrf("quiet cafe");
    await flushBackgroundWork();
    resolveQuery(queryRows());

    const results = await Promise.all([first, second]);

    expect(results.map((result) => result[0].id)).toEqual([
      "venue-1",
      "venue-1",
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("caches empty results with their fuzzy metadata", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    const filters = { enableFuzzyFallback: false };

    const first = await searchVenuesWithRrf("empty results", filters);
    const second = await searchVenuesWithRrf("empty results", filters);

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(0);
    expect(first.fuzzyMatched).toBe(false);
    expect(second.fuzzyMatched).toBe(false);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(getHybridVenueSearchCacheMetrics()).toMatchObject({
      requests: 2,
      hits: 1,
      misses: 1,
    });
  });

  it("caches empty results after the normal fuzzy fallback completes", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

    const first = await searchVenuesWithRrf("empty with fallback");
    const second = await searchVenuesWithRrf("empty with fallback");

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(0);
    expect(first.fuzzyMatched).toBe(false);
    expect(second.fuzzyMatched).toBe(false);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(getHybridVenueSearchCacheMetrics()).toMatchObject({
      requests: 2,
      hits: 1,
      misses: 1,
    });
  });

  it("warms trending result caches asynchronously and excludes background requests from metrics", async () => {
    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValue({
      recentEvents: [event("Quiet Cafe")],
    });
    let resolveQuery: (rows: unknown[]) => void = () => {};
    (prisma.$queryRaw as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );

    expect(prefetchTrendingVenueSearches()).toBeInstanceOf(Promise);
    await flushBackgroundWork();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    resolveQuery(queryRows());
    await flushBackgroundWork();

    await searchVenuesWithRrf("quiet cafe");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(getHybridVenueSearchCacheMetrics()).toEqual({
      requests: 1,
      hits: 1,
      misses: 0,
      hitRatio: 1,
    });
  });

  it("schedules prefetch without awaiting background database work", async () => {
    const { scheduleTrendingVenueSearchPrefetch } =
      await import("@/lib/search/hybridVenueSearch");
    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValue({
      recentEvents: [event("coffee")],
    });
    let resolveQuery: (rows: unknown[]) => void = () => {};
    (prisma.$queryRaw as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );

    expect(scheduleTrendingVenueSearchPrefetch()).toBeUndefined();
    await flushBackgroundWork();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    resolveQuery(queryRows());
    await flushBackgroundWork();
  });

  it("serves stale results immediately while one background refresh runs", async () => {
    await searchVenuesWithRrf("stale query");
    const [key, cacheEntry] = [...inMemorySWRCache.entries()][0];
    cacheEntry.cachedAt = Date.now() - 6 * 60 * 1000;

    let resolveQuery: (rows: unknown[]) => void = () => {};
    (prisma.$queryRaw as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );

    const stale = await searchVenuesWithRrf("stale query");
    expect(stale[0].id).toBe("venue-1");
    await flushBackgroundWork();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);

    resolveQuery(queryRows("venue-2"));
    await flushBackgroundWork();
    expect(inMemorySWRCache.get(key)?.cachedAt).toBeGreaterThan(
      Date.now() - 1000,
    );
  });

  it("deduplicates concurrent stale refreshes and fails open on refresh errors", async () => {
    await searchVenuesWithRrf("duplicate stale");
    const cacheEntry = [...inMemorySWRCache.values()][0];
    cacheEntry.cachedAt = Date.now() - 6 * 60 * 1000;
    let rejectQuery: (error: Error) => void = () => {};
    (prisma.$queryRaw as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectQuery = reject;
        }),
    );
    jest.spyOn(console, "error").mockImplementation(() => {});

    const results = await Promise.all([
      searchVenuesWithRrf("duplicate stale"),
      searchVenuesWithRrf("duplicate stale"),
    ]);
    expect(results.map((result) => result[0].id)).toEqual([
      "venue-1",
      "venue-1",
    ]);
    await flushBackgroundWork();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    rejectQuery(new Error("provider failed"));
    await flushBackgroundWork();
    expect(getHybridVenueSearchCacheMetrics()).toMatchObject({
      requests: 3,
      hits: 2,
      misses: 1,
    });
  });

  it("does not serve expired stale entries and tolerates Redis read failures", async () => {
    await searchVenuesWithRrf("expired query");
    const cacheEntry = [...inMemorySWRCache.values()][0];
    cacheEntry.cachedAt = Date.now() - 16 * 60 * 1000;
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce(queryRows("fresh"));

    const fresh = await searchVenuesWithRrf("expired query");
    expect(fresh[0].id).toBe("fresh");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);

    clearMemorySWRCache();
    jest.spyOn(console, "error").mockImplementation(() => {});
    (getRedis as jest.Mock).mockReturnValue({
      get: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
    });
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce(
      queryRows("fallback"),
    );
    await expect(searchVenuesWithRrf("redis failure")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "fallback" })]),
    );
  });

  it("limits simultaneous background query warming and keeps tasks independent", async () => {
    const now = Date.now();
    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValue({
      recentEvents: Array.from({ length: 10 }, (_, index) =>
        event(`trend ${index}`, now - index),
      ),
    });
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    (prisma.$queryRaw as jest.Mock).mockImplementation(async () => {
      const call = calls++;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (call === 0) throw new Error("one search provider failure");
        return queryRows();
      } finally {
        active -= 1;
      }
    });
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await prefetchTrendingVenueSearches();

    expect(MAX_CONCURRENT_TRENDING_SEARCH_REFRESHES).toBe(2);
    expect(maximumActive).toBeLessThanOrEqual(
      MAX_CONCURRENT_TRENDING_SEARCH_REFRESHES,
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(10);
    expect(inMemorySWRCache.size).toBe(9);
    expect(getHybridVenueSearchCacheMetrics().requests).toBe(0);
  });

  it("completes warming all ten stale trending queries without nested limiter deadlock", async () => {
    const now = Date.now();
    const queries = Array.from(
      { length: 10 },
      (_, index) => `stale trend ${index}`,
    );
    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValue({
      recentEvents: queries.map((query, index) => event(query, now - index)),
    });

    for (const query of queries) {
      await searchVenuesWithRrf(query);
    }
    for (const entry of inMemorySWRCache.values()) {
      entry.cachedAt = Date.now() - 6 * 60 * 1000;
    }

    let active = 0;
    let maximumActive = 0;
    (prisma.$queryRaw as jest.Mock).mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return queryRows("refreshed");
      } finally {
        active -= 1;
      }
    });

    await prefetchTrendingVenueSearches();
    await flushBackgroundWork();
    await Promise.all([...inFlightRevalidations.values()]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(20);
    expect(maximumActive).toBeLessThanOrEqual(
      MAX_CONCURRENT_TRENDING_SEARCH_REFRESHES,
    );
    expect(inMemorySWRCache.size).toBe(queries.length);
    expect(
      [...inMemorySWRCache.values()].every(
        (entry) => entry.data.results[0]?.id === "refreshed",
      ),
    ).toBe(true);
  });

  it("serves stale results when the refresh queue overflows and drains queued work", async () => {
    const queries = Array.from({ length: 103 }, (_, index) => `queue ${index}`);
    for (const query of queries) {
      await searchVenuesWithRrf(query);
    }
    for (const entry of inMemorySWRCache.values()) {
      entry.cachedAt = Date.now() - 6 * 60 * 1000;
    }

    let active = 0;
    let maximumActive = 0;
    let releaseRefreshes = () => {};
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefreshes = resolve;
    });
    (prisma.$queryRaw as jest.Mock).mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await refreshGate;
      active -= 1;
      return queryRows("refreshed");
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const staleResults = await Promise.all(
      queries.map((query) => searchVenuesWithRrf(query)),
    );
    await flushBackgroundWork();

    const callsBeforeRelease = (prisma.$queryRaw as jest.Mock).mock.calls
      .length;
    releaseRefreshes();
    await Promise.all([...inFlightRevalidations.values()]);

    expect(staleResults.every((results) => results[0]?.id === "venue-1")).toBe(
      true,
    );
    expect(maximumActive).toBe(MAX_CONCURRENT_TRENDING_SEARCH_REFRESHES);
    expect(callsBeforeRelease).toBe(105);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Background revalidation fetcher failed"),
      expect.objectContaining({
        message: "Trending venue search refresh queue is full",
      }),
    );

    expect(active).toBe(0);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(205);
    expect(inMemorySWRCache.size).toBe(queries.length);
  });

  it("exposes cache hit ratio through the existing admin system metrics", async () => {
    await searchVenuesWithRrf("metrics query");
    await searchVenuesWithRrf("metrics query");
    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValue({
      recentEvents: [],
    });

    const metrics = await getAdminSystemMetrics("7d");

    expect(metrics.hybridSearchCache).toEqual({
      requests: 2,
      hits: 1,
      misses: 1,
      hitRatio: 0.5,
    });
  });
});
