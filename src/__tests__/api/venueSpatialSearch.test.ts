import { NextRequest } from "next/server";
import { GET } from "@/app/api/venues/search/route";
import { prisma } from "@/lib/prisma";
import * as venueCache from "@/lib/cache/venueCache";
import * as phoneticSearch from "@/lib/search/phoneticVenueSearch";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

jest.mock("@/lib/cache/venueCache", () => ({
  getLatestVenueTimestamp: jest.fn().mockResolvedValue(1700000000000),
  generateETag: jest.fn().mockReturnValue('"1700000000000"'),
}));

jest.mock("@/lib/search/phoneticVenueSearch", () => ({
  searchVenuesPhonetic: jest.fn().mockResolvedValue([]),
}));

const nearbyVenue = {
  id: "v_near_1",
  name: "Bean Around the World",
  category: "cafe",
  address: "12 Cordova St",
  rating: 4.6,
  imageUrl: null,
  latitude: 49.2827,
  longitude: -123.1207,
  distanceMeters: 421.5,
};

describe("Venue Spatial Search API (/api/venues/search?lat&lng) — PostGIS ST_DWithin", () => {
  const baseUrl = "https://work-sphere.vercel.app/api/venues/search";

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([nearbyVenue]);
  });

  it("executes a single PostGIS query with ST_DWithin, KNN ordering, and SQL-projected distance", async () => {
    const request = new NextRequest(
      new URL(`${baseUrl}?lat=49.2827&lng=-123.1207&radiusMeters=5000`),
      { method: "GET", headers: { Accept: "application/json" } }
    );

    const response = await GET(request);
    expect(response.status).toBe(200);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [sqlStrings, ...sqlValues] = (prisma.$queryRaw as jest.Mock)
      .mock.calls[0];
    const sql = sqlStrings.join("?");

    // Filtering happens inside PostgreSQL via the GiST-indexed geography column
    expect(sql).toContain('ST_DWithin');
    expect(sql).toContain('ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography');
    // KNN ordering via the <-> distance operator
    expect(sql).toContain('<->');
    // Distance in meters is returned directly from the SQL projection
    expect(sql).toContain('ST_Distance');
    expect(sql).toContain('AS "distanceMeters"');
    // No full table load / in-memory filtering
    expect(sql).not.toMatch(/SELECT\s+\*\s+FROM/i);

    // Parameter binding: [lng, lat] repeated for select/filter/order, then radius, limit
    expect(sqlValues).toEqual([
      -123.1207,
      49.2827,
      -123.1207,
      49.2827,
      5000,
      -123.1207,
      49.2827,
      20,
    ]);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: "v_near_1",
      distanceMeters: 421.5,
    });
  });

  it("defaults radiusMeters to 5000 and clamps the result limit", async () => {
    const request = new NextRequest(
      new URL(`${baseUrl}?lat=49.2827&lng=-123.1207&limit=500`),
      { method: "GET" }
    );

    const response = await GET(request);
    expect(response.status).toBe(200);

    const [, ...sqlValues] = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    // radius defaults to 5000, limit clamped to MAX_SPATIAL_RESULT_LIMIT (50)
    expect(sqlValues).toEqual([
      -123.1207,
      49.2827,
      -123.1207,
      49.2827,
      5000,
      -123.1207,
      49.2827,
      50,
    ]);
  });

  it("rejects lat without lng", async () => {
    const request = new NextRequest(new URL(`${baseUrl}?lat=49.2827`), {
      method: "GET",
    });

    const response = await GET(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("required together");
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("rejects out-of-range latitude", async () => {
    const request = new NextRequest(
      new URL(`${baseUrl}?lat=999&lng=-123.1207`),
      { method: "GET" }
    );

    const response = await GET(request);
    expect(response.status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("rejects non-positive or oversized radiusMeters", async () => {
    const zeroRadius = new NextRequest(
      new URL(`${baseUrl}?lat=49.2827&lng=-123.1207&radiusMeters=0`),
      { method: "GET" }
    );
    expect((await GET(zeroRadius)).status).toBe(400);

    const hugeRadius = new NextRequest(
      new URL(`${baseUrl}?lat=49.2827&lng=-123.1207&radiusMeters=99999999`),
      { method: "GET" }
    );
    expect((await GET(hugeRadius)).status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("still serves phonetic text search when no coordinates are provided", async () => {
    (phoneticSearch.searchVenuesPhonetic as jest.Mock).mockResolvedValue([
      { id: "v_1", name: "Silent Work Cafe", category: "CAFE", score: 0.9 },
    ]);

    const request = new NextRequest(new URL(`${baseUrl}?q=cafe`), {
      method: "GET",
    });

    const response = await GET(request);
    expect(response.status).toBe(200);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(phoneticSearch.searchVenuesPhonetic).toHaveBeenCalledWith(
      "cafe",
      20
    );

    const body = await response.json();
    expect(body.results[0].name).toBe("Silent Work Cafe");
  });

  it("applies public cache-control and ETag headers to spatial responses", async () => {
    const request = new NextRequest(
      new URL(`${baseUrl}?lat=49.2827&lng=-123.1207`),
      { method: "GET", headers: { Accept: "application/json" } }
    );

    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    expect(response.headers.get("etag")).toBe('"1700000000000"');
    expect(venueCache.getLatestVenueTimestamp).toHaveBeenCalled();
  });

  it("bypasses cache for authenticated spatial requests", async () => {
    const request = new NextRequest(
      new URL(`${baseUrl}?lat=49.2827&lng=-123.1207`),
      {
        method: "GET",
        headers: { authorization: "Bearer secret-token-xyz" },
      }
    );

    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate"
    );
    expect(response.headers.get("etag")).toBeNull();
  });
});
