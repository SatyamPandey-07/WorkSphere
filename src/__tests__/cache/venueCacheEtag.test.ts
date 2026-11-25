import {
  getLatestVenueTimestamp,
  generateETag,
  BoundingBox,
  isValidBoundingBox,
} from "@/lib/cache/venueCache";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/venues/search/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("@/lib/search/phoneticVenueSearch", () => ({
  searchVenuesPhonetic: jest.fn().mockResolvedValue([
    {
      id: "venue-1",
      name: "Downtown Workhub",
      category: "coworking",
      score: 1.0,
    },
  ]),
}));

describe("Venue Search ETag Stability & Invalidation (#10314)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const bboxSF: BoundingBox = {
    minLat: 37.7,
    maxLat: 37.8,
    minLng: -122.5,
    maxLng: -122.4,
  };

  const bboxNYC: BoundingBox = {
    minLat: 40.7,
    maxLat: 40.8,
    minLng: -74.0,
    maxLng: -73.9,
  };

  it("1. returns stable ETags for unchanged persisted venue data across repeated runs", async () => {
    const fixedTimestamp = new Date("2026-05-15T12:00:00Z").getTime();
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      updatedAt: new Date(fixedTimestamp),
    });

    const ts1 = await getLatestVenueTimestamp(bboxSF);
    const ts2 = await getLatestVenueTimestamp(bboxSF);

    expect(ts1).toBe(fixedTimestamp);
    expect(ts2).toBe(fixedTimestamp);

    const etag1 = generateETag(ts1, bboxSF);
    const etag2 = generateETag(ts2, bboxSF);

    expect(etag1).toBe(etag2);
    expect(etag1).toBe(`"${fixedTimestamp}-37.7000:37.8000:-122.5000:-122.4000"`);
  });

  it("2. updates ETag when relevant venue is updated in database", async () => {
    const initialTimestamp = new Date("2026-05-15T12:00:00Z").getTime();
    (prisma.venue.findFirst as jest.Mock).mockResolvedValueOnce({
      updatedAt: new Date(initialTimestamp),
    });

    const etagInitial = generateETag(
      await getLatestVenueTimestamp(bboxSF),
      bboxSF,
    );

    // Venue receives an update 2 hours later
    const updatedTimestamp = new Date("2026-05-15T14:00:00Z").getTime();
    (prisma.venue.findFirst as jest.Mock).mockResolvedValueOnce({
      updatedAt: new Date(updatedTimestamp),
    });

    const etagUpdated = generateETag(
      await getLatestVenueTimestamp(bboxSF),
      bboxSF,
    );

    expect(etagInitial).not.toBe(etagUpdated);
    expect(etagUpdated).toBe(`"${updatedTimestamp}-37.7000:37.8000:-122.5000:-122.4000"`);
  });

  it("3. produces independent, bounding-box-specific cache validators", async () => {
    const ts = new Date("2026-05-15T12:00:00Z").getTime();
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      updatedAt: new Date(ts),
    });

    const etagSF = generateETag(await getLatestVenueTimestamp(bboxSF), bboxSF);
    const etagNYC = generateETag(await getLatestVenueTimestamp(bboxNYC), bboxNYC);

    expect(etagSF).not.toBe(etagNYC);
    expect(etagSF).toContain("37.7000:37.8000");
    expect(etagNYC).toContain("40.7000:40.8000");

    // Verifies Prisma was queried with bounding box filters
    expect(prisma.venue.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          latitude: { gte: bboxSF.minLat, lte: bboxSF.maxLat },
          longitude: { gte: bboxSF.minLng, lte: bboxSF.maxLng },
        }),
      }),
    );
  });

  it("4. returns HTTP 304 Not Modified when If-None-Match matches the current ETag", async () => {
    const fixedTimestamp = new Date("2026-05-15T12:00:00Z").getTime();
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      updatedAt: new Date(fixedTimestamp),
    });

    const expectedETag = generateETag(fixedTimestamp, bboxSF);

    const request = new NextRequest(
      `https://worksphere.io/api/venues/search?minLat=37.7&maxLat=37.8&minLng=-122.5&maxLng=-122.4`,
      {
        method: "GET",
        headers: {
          "if-none-match": expectedETag,
        },
      },
    );

    const response = await GET(request);
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(expectedETag);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("5. handles empty result sets and missing timestamps deterministically without Date.now()", async () => {
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

    const ts1 = await getLatestVenueTimestamp(bboxSF);
    const ts2 = await getLatestVenueTimestamp(bboxSF);

    // Empty result sets must return deterministic 0 rather than non-deterministic Date.now()
    expect(ts1).toBe(0);
    expect(ts2).toBe(0);

    const etag = generateETag(ts1, bboxSF);
    expect(etag).toBe(`"0-37.7000:37.8000:-122.5000:-122.4000"`);
  });
});
