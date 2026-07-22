import { GET } from "@/app/api/location/route";
import { NextRequest } from "next/server";

describe("GET /api/location — Multi-Provider Geolocation & Fallback (#1113)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
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

  it("falls back to ip-api.com if ipwho.is fails", async () => {
    global.fetch = jest
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

    const req = new NextRequest("http://localhost:3000/api/location", {
      headers: { "x-forwarded-for": "185.86.151.1" },
    });

    const response = await GET(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.source).toBe("ip-api.com");
    expect(json.city).toBe("London");
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
