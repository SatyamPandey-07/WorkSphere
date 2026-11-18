import {
  ROUTE_CACHE_MAX_ENTRIES,
  ROUTE_CACHE_STALE_MS,
  ROUTE_CACHE_TTL_MS,
  buildRouteCacheKey,
  clearRouteCache,
  getOrRefreshRoute,
} from "@/lib/accessibility/routeCache";
import { getRedis } from "@/lib/redis";

jest.mock("@/lib/redis", () => ({ getRedis: jest.fn(() => null) }));

const baseInput = {
  profile: "wheelchair",
  start: { lat: 40.73, lng: -73.99 },
  end: { lat: 40.731, lng: -73.989 },
  maxAllowedGrade: 8.33,
};

describe("route cache", () => {
  let now = 1_000_000;

  beforeEach(() => {
    clearRouteCache();
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    (getRedis as jest.Mock).mockReturnValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("buildRouteCacheKey", () => {
    it("treats coordinates within about 1m as the same key", () => {
      const a = buildRouteCacheKey(baseInput);
      const b = buildRouteCacheKey({
        ...baseInput,
        start: { lat: 40.730001, lng: -73.990004 },
      });
      expect(a).toBe(b);
    });

    it("separates different profiles, grades and coordinates", () => {
      const a = buildRouteCacheKey(baseInput);
      expect(buildRouteCacheKey({ ...baseInput, profile: "foot-walking" })).not.toBe(a);
      expect(buildRouteCacheKey({ ...baseInput, maxAllowedGrade: 5 })).not.toBe(a);
      expect(
        buildRouteCacheKey({ ...baseInput, end: { lat: 40.7312, lng: -73.989 } }),
      ).not.toBe(a);
    });

    it("does not split keys on negative zero", () => {
      const zero = buildRouteCacheKey({ ...baseInput, start: { lat: 0, lng: 0 } });
      const negative = buildRouteCacheKey({
        ...baseInput,
        start: { lat: -0.000001, lng: -0.000001 },
      });
      expect(negative).toBe(zero);
    });
  });

  describe("getOrRefreshRoute", () => {
    it("serves a cache hit without calling the fetcher again", async () => {
      const fetcher = jest.fn().mockResolvedValue({ route: 1 });
      const key = buildRouteCacheKey(baseInput);

      await expect(getOrRefreshRoute(key, fetcher)).resolves.toEqual({ route: 1 });
      now += ROUTE_CACHE_TTL_MS - 1;
      await expect(getOrRefreshRoute(key, fetcher)).resolves.toEqual({ route: 1 });

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("shares one upstream request between concurrent callers", async () => {
      const fetcher = jest.fn().mockResolvedValue({ route: 1 });
      const key = buildRouteCacheKey(baseInput);

      await Promise.all([
        getOrRefreshRoute(key, fetcher),
        getOrRefreshRoute(key, fetcher),
        getOrRefreshRoute(key, fetcher),
      ]);

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("returns stale data immediately and refreshes in the background", async () => {
      const fetcher = jest
        .fn()
        .mockResolvedValueOnce({ route: "old" })
        .mockResolvedValueOnce({ route: "new" });
      const key = buildRouteCacheKey(baseInput);

      await getOrRefreshRoute(key, fetcher);
      now += ROUTE_CACHE_TTL_MS + 1;

      await expect(getOrRefreshRoute(key, fetcher)).resolves.toEqual({ route: "old" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetcher).toHaveBeenCalledTimes(2);

      await expect(getOrRefreshRoute(key, fetcher)).resolves.toEqual({ route: "new" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("keeps serving stale data when the background refresh fails", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const fetcher = jest
        .fn()
        .mockResolvedValueOnce({ route: "old" })
        .mockRejectedValueOnce(new Error("upstream down"));
      const key = buildRouteCacheKey(baseInput);

      await getOrRefreshRoute(key, fetcher);
      now += ROUTE_CACHE_TTL_MS + 1;

      await expect(getOrRefreshRoute(key, fetcher)).resolves.toEqual({ route: "old" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(warn).toHaveBeenCalled();
    });

    it("refetches once the stale window has passed", async () => {
      const fetcher = jest
        .fn()
        .mockResolvedValueOnce({ route: "old" })
        .mockResolvedValueOnce({ route: "new" });
      const key = buildRouteCacheKey(baseInput);

      await getOrRefreshRoute(key, fetcher);
      now += ROUTE_CACHE_TTL_MS + ROUTE_CACHE_STALE_MS + 1;

      await expect(getOrRefreshRoute(key, fetcher)).resolves.toEqual({ route: "new" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("does not cache failures", async () => {
      const fetcher = jest
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ route: 1 });
      const key = buildRouteCacheKey(baseInput);

      await expect(getOrRefreshRoute(key, fetcher)).rejects.toThrow("boom");
      await expect(getOrRefreshRoute(key, fetcher)).resolves.toEqual({ route: 1 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("evicts the least recently used entry past the size limit", async () => {
      const fetcher = jest.fn(async () => ({ route: 1 }));
      for (let i = 0; i < ROUTE_CACHE_MAX_ENTRIES + 1; i++) {
        await getOrRefreshRoute(`key-${i}`, fetcher);
      }
      expect(fetcher).toHaveBeenCalledTimes(ROUTE_CACHE_MAX_ENTRIES + 1);

      await getOrRefreshRoute(`key-${ROUTE_CACHE_MAX_ENTRIES}`, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(ROUTE_CACHE_MAX_ENTRIES + 1);

      await getOrRefreshRoute("key-0", fetcher);
      expect(fetcher).toHaveBeenCalledTimes(ROUTE_CACHE_MAX_ENTRIES + 2);
    });

    it("reads from and writes to redis when configured", async () => {
      const store = new Map<string, unknown>();
      const redis = {
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        set: jest.fn(async (key: string, value: unknown) => {
          store.set(key, value);
          return "OK";
        }),
      };
      (getRedis as jest.Mock).mockReturnValue(redis);
      const fetcher = jest.fn().mockResolvedValue({ route: 1 });
      const key = buildRouteCacheKey(baseInput);

      await getOrRefreshRoute(key, fetcher);
      expect(redis.set).toHaveBeenCalledWith(
        key,
        expect.objectContaining({ value: { route: 1 } }),
        { ex: (ROUTE_CACHE_TTL_MS + ROUTE_CACHE_STALE_MS) / 1000 },
      );

      clearRouteCache();
      await expect(getOrRefreshRoute(key, fetcher)).resolves.toEqual({ route: 1 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("falls back to the upstream call when redis throws", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      (getRedis as jest.Mock).mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error("redis down")),
        set: jest.fn().mockRejectedValue(new Error("redis down")),
      });
      const fetcher = jest.fn().mockResolvedValue({ route: 1 });

      await expect(getOrRefreshRoute("k", fetcher)).resolves.toEqual({ route: 1 });
    });
  });
});
