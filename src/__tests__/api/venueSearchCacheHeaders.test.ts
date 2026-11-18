import { NextRequest } from "next/server";
import { GET, shouldBypassCache } from "@/app/api/venues/search/route";
import * as venueCache from "@/lib/cache/venueCache";
import * as phoneticSearch from "@/lib/search/phoneticVenueSearch";

jest.mock("@/lib/cache/venueCache", () => ({
  getLatestVenueTimestamp: jest.fn().mockResolvedValue(1700000000000),
  generateETag: jest.fn().mockReturnValue('"1700000000000"'),
}));

jest.mock("@/lib/search/phoneticVenueSearch", () => ({
  searchVenuesPhonetic: jest.fn().mockResolvedValue([
    {
      id: "v_test_1",
      name: "Silent Work Cafe",
      description: "Quiet library vibes",
      category: "CAFE",
      score: 0.95,
    },
  ]),
}));

describe("Venue Search API Caching Headers (/api/venues/search)", () => {
  const baseUrl = "https://work-sphere.vercel.app/api/venues/search";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Public Read-Only Requests", () => {
    it("returns public stale-while-revalidate caching headers and Vary header", async () => {
      const request = new NextRequest(new URL(`${baseUrl}?q=cafe`), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      expect(response.headers.get("cache-control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=300",
      );
      expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
      expect(response.headers.get("etag")).toBe('"1700000000000"');

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].name).toBe("Silent Work Cafe");
    });

    it("returns 304 Not Modified when If-None-Match matches ETag for public requests", async () => {
      const request = new NextRequest(new URL(baseUrl), {
        method: "GET",
        headers: {
          "if-none-match": '"1700000000000"',
          Accept: "application/json",
        },
      });

      const response = await GET(request);
      expect(response.status).toBe(304);
      expect(response.headers.get("cache-control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=300",
      );
      expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
      expect(response.headers.get("etag")).toBe('"1700000000000"');
    });
  });

  describe("Cache Bypassing", () => {
    it("bypasses cache when Authorization header is present", async () => {
      const request = new NextRequest(new URL(`${baseUrl}?q=library`), {
        method: "GET",
        headers: {
          authorization: "Bearer secret-token-xyz",
          Accept: "application/json",
        },
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-cache, no-store, max-age=0, must-revalidate",
      );
      expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
      expect(response.headers.get("etag")).toBeNull();
    });

    it("bypasses cache when personalized location cookies are provided via Cookie header", async () => {
      const request = new NextRequest(new URL(baseUrl), {
        method: "GET",
        headers: {
          cookie: "user_location=37.7749%2C-122.4194; worksphere-theme=dark",
          Accept: "application/json",
        },
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-cache, no-store, max-age=0, must-revalidate",
      );
      expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
      expect(response.headers.get("etag")).toBeNull();
    });

    it("bypasses cache when user_lat and user_lng cookies are present", async () => {
      const request = new NextRequest(new URL(baseUrl), {
        method: "GET",
        headers: {
          cookie: "user_lat=40.7128; user_lng=-74.0060",
          Accept: "application/json",
        },
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-cache, no-store, max-age=0, must-revalidate",
      );
      expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
    });

    it("does not bypass cache for unrelated cookies (e.g., theme or analytics)", async () => {
      const request = new NextRequest(new URL(baseUrl), {
        method: "GET",
        headers: {
          cookie: "worksphere-theme=dark; consent=true",
          Accept: "application/json",
        },
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=300",
      );
      expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
    });
  });

  describe("shouldBypassCache helper", () => {
    it("returns true for authorization header", () => {
      const req = new NextRequest(new URL(baseUrl), {
        headers: { authorization: "Bearer xyz" },
      });
      expect(shouldBypassCache(req)).toBe(true);
    });

    it("returns true for geolocation cookies", () => {
      const req = new NextRequest(new URL(baseUrl), {
        headers: { cookie: "geolocation=true" },
      });
      expect(shouldBypassCache(req)).toBe(true);
    });

    it("returns false for standard clean request", () => {
      const req = new NextRequest(new URL(baseUrl));
      expect(shouldBypassCache(req)).toBe(false);
    });
  });
});
