import {
  searchPhotoDetails,
  getVenuePhotoDetails,
  getVenuePhotoUrl,
  searchPhoto,
  clearAttributionCacheForTest,
} from "@/lib/googlePlaces";
import { GET } from "@/app/api/venues/[venueId]/photo/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

describe("Pexels Photo Attribution", () => {
  const originalEnv = process.env;
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    clearAttributionCacheForTest();
    process.env = { ...originalEnv, PEXELS_API_KEY: "test-pexels-key" };
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("searchPhotoDetails", () => {
    it("returns null if PEXELS_API_KEY is not defined", async () => {
      delete process.env.PEXELS_API_KEY;
      const result = await searchPhotoDetails("Coffee Shop");
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fetches from Pexels API and parses photographer attribution correctly", async () => {
      const mockPexelsResponse = {
        photos: [
          {
            id: 12345,
            url: "https://www.pexels.com/photo/cozy-cafe-12345/",
            photographer: "Jane Doe",
            photographer_url: "https://www.pexels.com/@janedoe",
            src: {
              large:
                "https://images.pexels.com/photos/12345/cafe.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPexelsResponse,
      });

      const result = await searchPhotoDetails("Cozy Cafe");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "https://api.pexels.com/v1/search?query=Cozy+Cafe",
        ),
        expect.objectContaining({
          headers: { Authorization: "test-pexels-key" },
        }),
      );

      expect(result).toEqual({
        url: "https://images.pexels.com/photos/12345/cafe.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
        photographer: "Jane Doe",
        photographerUrl: "https://www.pexels.com/@janedoe",
        photoPageUrl: "https://www.pexels.com/photo/cozy-cafe-12345/",
        source: "pexels",
      });
    });

    it("returns null when Pexels API returns no photos", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ photos: [] }),
      });

      const result = await searchPhotoDetails("Nonexistent Place");
      expect(result).toBeNull();
    });

    it("returns null when Pexels API fetch fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
      });

      const result = await searchPhotoDetails("Cozy Cafe");
      expect(result).toBeNull();
    });
  });

  describe("getVenuePhotoDetails", () => {
    it("returns cached photoReference from database when already cached", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValueOnce({
        photoReference: "https://images.pexels.com/photos/999/cached.jpeg",
      });

      const result = await getVenuePhotoDetails(
        "venue-123",
        "Cozy Cafe",
        40.71,
        -74.0,
      );

      expect(prisma.venue.findUnique).toHaveBeenCalledWith({
        where: { placeId: "venue-123" },
        select: { photoReference: true },
      });
      expect(result).toEqual({
        url: "https://images.pexels.com/photos/999/cached.jpeg",
        source: "pexels",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("searches photo details on database miss and persists URL", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValueOnce({
        photoReference: null,
      });
      (prisma.venue.upsert as jest.Mock).mockResolvedValueOnce({});

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          photos: [
            {
              url: "https://www.pexels.com/photo/fresh-555/",
              photographer: "Alex Smith",
              photographer_url: "https://www.pexels.com/@alexsmith",
              src: {
                large: "https://images.pexels.com/photos/555/fresh.jpeg",
              },
            },
          ],
        }),
      });

      const result = await getVenuePhotoDetails(
        "venue-new",
        "Fresh Cafe",
        40.71,
        -74.0,
      );

      expect(result).toEqual({
        url: "https://images.pexels.com/photos/555/fresh.jpeg",
        photographer: "Alex Smith",
        photographerUrl: "https://www.pexels.com/@alexsmith",
        photoPageUrl: "https://www.pexels.com/photo/fresh-555/",
        source: "pexels",
      });

      expect(prisma.venue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { placeId: "venue-new" },
          update: {
            photoReference: "https://images.pexels.com/photos/555/fresh.jpeg",
          },
        }),
      );
    });
  });

  describe("Backward compatibility functions", () => {
    it("getVenuePhotoUrl returns string URL", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValueOnce({
        photoReference: "https://images.pexels.com/photos/111/cafe.jpeg",
      });

      const url = await getVenuePhotoUrl("v-111", "Cafe 111", 40.7, -74.0);
      expect(url).toBe("https://images.pexels.com/photos/111/cafe.jpeg");
    });

    it("searchPhoto returns string URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          photos: [
            {
              src: { large: "https://images.pexels.com/photos/222/cafe.jpeg" },
            },
          ],
        }),
      });

      const url = await searchPhoto("Cafe 222");
      expect(url).toBe("https://images.pexels.com/photos/222/cafe.jpeg");
    });
  });

  describe("GET /api/venues/[venueId]/photo route", () => {
    it("returns JSON metadata with photographer info when requested with ?metadata=true", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValueOnce({
        photoReference: null,
      });
      (prisma.venue.upsert as jest.Mock).mockResolvedValueOnce({});

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          photos: [
            {
              url: "https://www.pexels.com/photo/sunny-cafe-777/",
              photographer: "Maria Garcia",
              photographer_url: "https://www.pexels.com/@mariagarcia",
              src: {
                large: "https://images.pexels.com/photos/777/sunny.jpeg",
              },
            },
          ],
        }),
      });

      const req = new NextRequest(
        "http://localhost:3000/api/venues/venue-777/photo?name=Sunny+Cafe&lat=40.7128&lng=-74.0060&metadata=true",
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "venue-777" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        venueId: "venue-777",
        name: "Sunny Cafe",
        url: "/api/venues/venue-777/photo?name=Sunny%20Cafe&lat=40.7128&lng=-74.006",
        imageUrl: "https://images.pexels.com/photos/777/sunny.jpeg",
        source: "pexels",
        photographer: "Maria Garcia",
        photographerUrl: "https://www.pexels.com/@mariagarcia",
        photoPageUrl: "https://www.pexels.com/photo/sunny-cafe-777/",
      });
    });

    it("returns image stream with X-Photo-* attribution headers", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValueOnce({
        photoReference: null,
      });
      (prisma.venue.upsert as jest.Mock).mockResolvedValueOnce({});

      // Mock searchPhotoDetails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          photos: [
            {
              url: "https://www.pexels.com/photo/mountain-cafe-888/",
              photographer: "John Climber",
              photographer_url: "https://www.pexels.com/@johnclimber",
              src: {
                large: "https://images.pexels.com/photos/888/mountain.jpeg",
              },
            },
          ],
        }),
      });

      // Mock image byte fetch
      const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg" }),
        arrayBuffer: async () => imageBytes.buffer,
      });

      const req = new NextRequest(
        "http://localhost:3000/api/venues/venue-888/photo?name=Mountain+Cafe&lat=40.7128&lng=-74.0060",
      );

      const res = await GET(req, {
        params: Promise.resolve({ venueId: "venue-888" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("X-Photo-Source")).toBe("pexels");
      expect(
        decodeURIComponent(res.headers.get("X-Photo-Photographer") || ""),
      ).toBe("John Climber");
      expect(res.headers.get("X-Photo-Photographer-Url")).toBe(
        "https://www.pexels.com/@johnclimber",
      );
      expect(res.headers.get("X-Photo-Page-Url")).toBe(
        "https://www.pexels.com/photo/mountain-cafe-888/",
      );
      expect(res.headers.get("Access-Control-Expose-Headers")).toContain(
        "X-Photo-Photographer",
      );
    });
  });
});
