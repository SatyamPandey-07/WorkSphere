import { NextRequest } from "next/server";
import { GET } from "@/app/api/venues/[venueId]/photo/route";
import { getVenuePhotoUrl } from "@/lib/googlePlaces";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

describe("Venue Photo Endpoint - Canonical Metadata & Security (#9859)", () => {
  const originalEnv = process.env;
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.venue.update as jest.Mock).mockResolvedValue({});
    (prisma.venue.upsert as jest.Mock).mockResolvedValue({});
    process.env = { ...originalEnv, PEXELS_API_KEY: "test-pexels-key" };
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("Canonical DB metadata precedence", () => {
    it("uses canonical venue name and coordinates from database ignoring spoofed query params", async () => {
      const canonicalVenue = {
        id: "cuid-venue-1",
        placeId: "osm-venue-1",
        name: "Authentic Kyoto Tea House",
        latitude: 35.0116,
        longitude: 135.7681,
        photoReference: null,
      };

      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(canonicalVenue);
      (prisma.venue.update as jest.Mock).mockResolvedValue({});

      // Pexels search fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          photos: [
            {
              src: {
                large2x: "https://images.pexels.com/photos/101/kyoto.jpg",
              },
            },
          ],
        }),
      });

      // Image proxy byte fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg" }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });

      const req = new NextRequest(
        "http://localhost:3000/api/venues/osm-venue-1/photo?name=SpoofedMaliciousVenue&lat=999&lng=999",
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "osm-venue-1" }),
      });

      expect(res.status).toBe(200);

      // Verify search was invoked with canonical name, NOT caller's spoofed name
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("query=Authentic+Kyoto+Tea+House"),
        expect.anything(),
      );

      // Verify DB cache was updated using the canonical ID
      expect(prisma.venue.update).toHaveBeenCalledWith({
        where: { id: "cuid-venue-1" },
        data: {
          photoReference: "https://images.pexels.com/photos/101/kyoto.jpg",
        },
      });
    });

    it("serves cached photoReference directly without external provider lookup or rate limit check", async () => {
      const canonicalVenue = {
        id: "cuid-venue-2",
        placeId: "osm-venue-2",
        name: "Precached Tokyo Cafe",
        latitude: 35.6895,
        longitude: 139.6917,
        photoReference: "https://images.pexels.com/photos/202/cached.jpg",
      };

      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(canonicalVenue);

      // Image proxy byte fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg" }),
        arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
      });

      const req = new NextRequest(
        "http://localhost:3000/api/venues/osm-venue-2/photo",
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "osm-venue-2" }),
      });

      expect(res.status).toBe(200);
      expect(rateLimit).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://images.pexels.com/photos/202/cached.jpg",
        expect.anything(),
      );
    });
  });

  describe("Validation for unregistered external venues", () => {
    it("returns HTTP 400 when external venue coordinates are missing or invalid", async () => {
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest(
        "http://localhost:3000/api/venues/osm-new/photo?name=NewCafe&lat=invalid&lng=10",
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "osm-new" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns HTTP 400 when external venue latitude is out of bounds", async () => {
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest(
        "http://localhost:3000/api/venues/osm-new/photo?name=NewCafe&lat=120&lng=10",
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "osm-new" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns HTTP 400 when external venue name is missing or exceeds max length", async () => {
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

      const longName = "A".repeat(250);
      const req = new NextRequest(
        `http://localhost:3000/api/venues/osm-new/photo?name=${longName}&lat=35&lng=139`,
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "osm-new" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("Rate limiting on cache misses", () => {
    it("returns HTTP 429 when rate limit on cache misses is exceeded", async () => {
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);
      (rateLimit as jest.Mock).mockResolvedValueOnce(false);

      const req = new NextRequest(
        "http://localhost:3000/api/venues/osm-miss/photo?name=FreshCafe&lat=35.0&lng=139.0",
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "osm-miss" }),
      });

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toBe("Too many requests");
    });
  });

  describe("External provider error handling", () => {
    it("returns HTTP 404 when no photo is found by external provider", async () => {
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ photos: [] }),
      });

      const req = new NextRequest(
        "http://localhost:3000/api/venues/osm-notfound/photo?name=ObscurePlace&lat=35.0&lng=139.0",
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "osm-notfound" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns HTTP 502 when image byte proxy fetch fails", async () => {
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          photos: [{ src: { large: "https://images.pexels.com/broken.jpg" } }],
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      });

      const req = new NextRequest(
        "http://localhost:3000/api/venues/osm-fail/photo?name=BrokenImagePlace&lat=35.0&lng=139.0",
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "osm-fail" }),
      });

      expect(res.status).toBe(502);
    });
  });

  describe("getVenuePhotoUrl lib function canonical resolution", () => {
    it("updates existing canonical venue record using canonical ID", async () => {
      const canonical = {
        id: "cuid-tea-5",
        placeId: "osm-tea-5",
        name: "Kyoto Green Tea",
        latitude: 35.1,
        longitude: 135.8,
        photoReference: null,
      };

      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(canonical);
      (prisma.venue.update as jest.Mock).mockResolvedValue({});

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          photos: [{ src: { large: "https://images.pexels.com/green.jpg" } }],
        }),
      });

      const url = await getVenuePhotoUrl("osm-tea-5", "SpoofedName", 99, 99);

      expect(url).toBe("https://images.pexels.com/green.jpg");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("query=Kyoto+Green+Tea"),
        expect.anything(),
      );
      expect(prisma.venue.update).toHaveBeenCalledWith({
        where: { id: "cuid-tea-5" },
        data: { photoReference: "https://images.pexels.com/green.jpg" },
      });
    });
  });
});
