import {
  fetchAccessibleRoute,
  normalizeAccessibilityCoordinate,
  RoutingProviderError,
} from "@/lib/accessibility/openRouteService";
import { clearRouteCache } from "@/lib/accessibility/routeCache";

jest.mock("@/lib/redis", () => ({ getRedis: jest.fn(() => null) }));

describe("OpenRouteService accessible routing", () => {
  const response = {
    features: [{
      geometry: {
        coordinates: [
          [-73.99, 40.73, 10],
          [-73.989, 40.731, 12],
        ],
      },
      properties: {
        summary: { distance: 150, duration: 120 },
        segments: [{
          steps: [{
            distance: 150,
            duration: 120,
            instruction: "Continue straight",
            way_points: [0, 1],
          }],
        }],
        extras: {
          suitability: { values: [[0, 1, 9]] },
          steepness: { values: [[0, 1, 1]] },
          surface: { values: [[0, 1, 3]] },
        },
      },
    }],
  };

  it("normalizes coordinate formats and rejects out-of-range values", () => {
    expect(normalizeAccessibilityCoordinate({ latitude: 40.7, longitude: -73.9 }))
      .toEqual({ lat: 40.7, lng: -73.9 });
    expect(normalizeAccessibilityCoordinate([40.7, -73.9]))
      .toEqual({ lat: 40.7, lng: -73.9 });
    expect(normalizeAccessibilityCoordinate([100, 500])).toBeNull();
  });

  it("requests real wheelchair directions and evaluates returned geometry/extras", async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => response,
    });
    const result = await fetchAccessibleRoute(
      { lat: 40.73, lng: -73.99 },
      { lat: 40.731, lng: -73.989 },
      { apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch, cache: false },
    );

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.openrouteservice.org/v2/directions/wheelchair/geojson",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "test-key" }),
      }),
    );
    expect(result.totalDistanceMeters).toBe(150);
    expect(result.geometry).toHaveLength(2);
    expect(result.evaluation.accessibilityScore).toBeGreaterThanOrEqual(40);
    expect(result.dataSource).toBe("OpenRouteService");
    const requestBody = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(requestBody.options.avoid_features).toContain("steps");
    expect(requestBody.options.profile_params.restrictions.maximum_incline).toBe(10);
  });

  it("fails explicitly when the provider is not configured", async () => {
    await expect(fetchAccessibleRoute(
      { lat: 40.73, lng: -73.99 },
      { lat: 40.731, lng: -73.989 },
      { apiKey: "" },
    )).rejects.toBeInstanceOf(RoutingProviderError);
  });

  it("does not return mock results when the provider rejects the route", async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "No wheelchair route found",
    });
    await expect(fetchAccessibleRoute(
      { lat: 40.73, lng: -73.99 },
      { lat: 40.731, lng: -73.989 },
      { apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch, cache: false },
    )).rejects.toMatchObject({ statusCode: 502 });
  });

  describe("route caching", () => {
    const start = { lat: 40.73, lng: -73.99 };
    const end = { lat: 40.731, lng: -73.989 };
    const makeFetch = () =>
      jest.fn().mockResolvedValue({ ok: true, json: async () => response });
    const run = (
      fetchFn: jest.Mock,
      s = start,
      e = end,
      extra: Record<string, unknown> = {},
    ) =>
      fetchAccessibleRoute(s, e, {
        apiKey: "test-key",
        fetchFn: fetchFn as unknown as typeof fetch,
        ...extra,
      });

    beforeEach(() => clearRouteCache());

    it("does not hit the upstream API twice for the same origin and destination", async () => {
      const fetchFn = makeFetch();
      const first = await run(fetchFn);
      const second = await run(fetchFn);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it("reuses the cached route when coordinates differ by less than 5 decimals", async () => {
      const fetchFn = makeFetch();
      await run(fetchFn);
      await run(fetchFn, { lat: 40.730001, lng: -73.990004 }, end);

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("serves the original venue from cache after toggling an alternate destination", async () => {
      const fetchFn = makeFetch();
      await run(fetchFn);
      await run(fetchFn, start, { lat: 40.74, lng: -73.98 });
      await run(fetchFn);

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("keeps wheelchair and walking profiles in separate cache entries", async () => {
      const fetchFn = makeFetch();
      await run(fetchFn);
      await run(fetchFn, start, end, { wheelchairMode: false });
      await run(fetchFn, start, end, { wheelchairMode: false });

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(fetchFn.mock.calls[1][0]).toContain("/directions/foot-walking/");
    });

    it("keeps different grade limits in separate cache entries", async () => {
      const fetchFn = makeFetch();
      await run(fetchFn, start, end, { maxAllowedGradePercent: 5 });
      await run(fetchFn, start, end, { maxAllowedGradePercent: 8.33 });

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("bypasses the cache when cache is false", async () => {
      const fetchFn = makeFetch();
      await run(fetchFn, start, end, { cache: false });
      await run(fetchFn, start, end, { cache: false });

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("does not cache provider errors", async () => {
      const failing = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      });
      await expect(run(failing)).rejects.toBeInstanceOf(RoutingProviderError);

      const fetchFn = makeFetch();
      await expect(run(fetchFn)).resolves.toBeDefined();
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });
});
