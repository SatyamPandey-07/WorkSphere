import { GET } from "@/app/api/location/route";
import { clearLocationCache } from "@/lib/locationCache";
import { resetRateLimit } from "@/lib/rateLimit";
import { NextRequest } from "next/server";

describe("GET /api/location — Multi-Provider Geolocation & Fallback (#1113, #1655)", () => {
  const originalFetch = global.fetch;
  const originalAbortSignalTimeout = AbortSignal.timeout;

  beforeAll(() => {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = jest.fn(() => {
        const controller = new AbortController();
        return controller.signal;
      }) as any;
    }
  });

  afterAll(() => {
    if (!originalAbortSignalTimeout) {
      // @ts-expect-error - JSDOM Node environment may not have AbortSignal.timeout
      delete AbortSignal.timeout;
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    clearLocationCache();
    resetRateLimit();
  });

  it("returns location data from primary provider ipwho.is when successful", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        latitude: 28.6139,
        longitude: 77.209,
        city: "New Delhi",
        region: "Delhi",
        country_code: "IN",
      }),
    } as any);

    const req = new NextRequest("http://localhost:3000/api/location", {
      headers: { "x-forwarded-for": "103.21.124.1" },
    });

    const response = await GET(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.source).toBe("ipwho.is");
    expect(json.city).toBe("New Delhi");
    expect(json.country).toBe("IN");
  });

  it("falls back to ip-api.com over HTTPS if ipwho.is fails", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false } as any) // ipwho.is fails
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          status: "success",
          lat: 51.5074,
          lon: -0.1278,
          city: "London",
          regionName: "England",
          countryCode: "GB",
        }),
      } as any);
    global.fetch = fetchMock;

    const req = new NextRequest("http://localhost:3000/api/location", {
      headers: { "x-forwarded-for": "185.86.151.1" },
    });

    const response = await GET(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.source).toBe("ip-api.com");
    expect(json.city).toBe("London");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ip-api.com/json/185.86.151.1",
      expect.anything(),
    );
  });

  it("caches location result for repeated requests from the same IP", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        latitude: 40.7128,
        longitude: -74.006,
        city: "New York",
        region: "New York",
        country_code: "US",
      }),
    } as any);
    global.fetch = fetchMock;

    const req1 = new NextRequest("http://localhost:3000/api/location", {
      headers: { "x-forwarded-for": "198.51.100.42" },
    });
    const res1 = await GET(req1);
    const json1 = await res1.json();

    const req2 = new NextRequest("http://localhost:3000/api/location", {
      headers: { "x-forwarded-for": "198.51.100.42" },
    });
    const res2 = await GET(req2);
    const json2 = await res2.json();

    expect(json1.city).toBe("New York");
    expect(json2.city).toBe("New York");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces rate limiting (10 req/min per IP) and gracefully degrades to default location", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        latitude: 34.0522,
        longitude: -118.2437,
        city: "Los Angeles",
        region: "California",
        country_code: "US",
      }),
    } as any);
    global.fetch = fetchMock;

    const testIp = "203.0.113.99";

    // Perform 10 requests (all allowed, first fetches, 2-10 hit cache)
    for (let i = 0; i < 10; i++) {
      clearLocationCache(); // clear cache to test rate limit capacity
      const req = new NextRequest("http://localhost:3000/api/location", {
        headers: { "x-forwarded-for": testIp },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);
    }

    // 11th request should exceed rate limit and return DEFAULT_LOCATION
    clearLocationCache();
    const excessReq = new NextRequest("http://localhost:3000/api/location", {
      headers: { "x-forwarded-for": testIp },
    });
    const excessRes = await GET(excessReq);
    const json = await excessRes.json();

    expect(excessRes.status).toBe(200);
    expect(json.city).toBe("San Francisco");
    expect(json.source).toBe("default");
  });

  it("returns clean default San Francisco location when run on localhost or when all external providers fail", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const req = new NextRequest("http://localhost:3000/api/location", {
      headers: { "x-forwarded-for": "127.0.0.1" },
    });

    const response = await GET(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.city).toBe("San Francisco");
    expect(json.lat).toBe(37.7749);
    expect(json.lng).toBe(-122.4194);
  });
});
