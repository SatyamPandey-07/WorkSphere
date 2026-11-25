import { parsePaginationParams } from "@/lib/validations";
import { GET } from "@/app/api/venues/route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/search/hybridVenueSearch", () => ({
  scheduleTrendingVenueSearchPrefetch: jest.fn(),
  searchVenuesWithRrf: jest.fn().mockResolvedValue([]),
  labelFuzzySuggestions: jest.fn().mockResolvedValue([]),
  indexVenueSearchEmbedding: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getRateLimitInfo: jest.fn().mockResolvedValue(null),
}));

describe("Venue Pagination Validation & Offset Safety", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.venue.count as jest.Mock).mockResolvedValue(0);
  });

  describe("parsePaginationParams Unit Tests", () => {
    it("applies default page=1 and limit=50 when parameters are omitted or empty", () => {
      const res1 = parsePaginationParams(null, null);
      expect(res1).toEqual({
        success: true,
        data: { page: 1, limit: 50, skip: 0 },
      });

      const res2 = parsePaginationParams("", "");
      expect(res2).toEqual({
        success: true,
        data: { page: 1, limit: 50, skip: 0 },
      });

      const res3 = parsePaginationParams(undefined, undefined);
      expect(res3).toEqual({
        success: true,
        data: { page: 1, limit: 50, skip: 0 },
      });
    });

    it("parses valid positive integer page and limit", () => {
      const res = parsePaginationParams("3", "25");
      expect(res).toEqual({
        success: true,
        data: { page: 3, limit: 25, skip: 50 },
      });
    });

    it("clamps limit to MAX_LIMIT (100) when requested limit exceeds it", () => {
      const res = parsePaginationParams("1", "500");
      expect(res).toEqual({
        success: true,
        data: { page: 1, limit: 100, skip: 0 },
      });
    });

    it("rejects non-numeric page parameter", () => {
      const res = parsePaginationParams("abc", "20");
      expect(res).toEqual({
        success: false,
        error: "page must be a positive integer",
      });
    });

    it("rejects non-numeric limit parameter", () => {
      const res = parsePaginationParams("1", "xyz");
      expect(res).toEqual({
        success: false,
        error: "limit must be a positive integer",
      });
    });

    it("rejects negative numbers", () => {
      expect(parsePaginationParams("-1", "20")).toEqual({
        success: false,
        error: "page must be a positive integer",
      });
      expect(parsePaginationParams("1", "-10")).toEqual({
        success: false,
        error: "limit must be a positive integer",
      });
    });

    it("rejects zero values", () => {
      expect(parsePaginationParams("0", "20")).toEqual({
        success: false,
        error: "page must be a positive integer",
      });
      expect(parsePaginationParams("1", "0")).toEqual({
        success: false,
        error: "limit must be a positive integer",
      });
    });

    it("rejects decimal numbers", () => {
      expect(parsePaginationParams("1.5", "20")).toEqual({
        success: false,
        error: "page must be a positive integer",
      });
      expect(parsePaginationParams("1", "20.9")).toEqual({
        success: false,
        error: "limit must be a positive integer",
      });
    });
  });

  describe("GET /api/venues Route Validation", () => {
    it("returns 400 Bad Request when page is not a numeric integer", async () => {
      const req = new NextRequest(
        "https://example.com/api/venues?page=abc&limit=20",
      );
      const res = await GET(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("page must be a positive integer");
      expect(prisma.venue.findMany).not.toHaveBeenCalled();
    });

    it("returns 400 Bad Request when limit is not a numeric integer", async () => {
      const req = new NextRequest(
        "https://example.com/api/venues?page=1&limit=abc",
      );
      const res = await GET(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("limit must be a positive integer");
      expect(prisma.venue.findMany).not.toHaveBeenCalled();
    });

    it("returns 400 Bad Request when page is negative or zero", async () => {
      const req1 = new NextRequest(
        "https://example.com/api/venues?page=-5&limit=20",
      );
      const res1 = await GET(req1);
      expect(res1.status).toBe(400);

      const req2 = new NextRequest(
        "https://example.com/api/venues?page=0&limit=20",
      );
      const res2 = await GET(req2);
      expect(res2.status).toBe(400);
    });

    it("processes valid pagination without error and calculates skip correctly", async () => {
      const req = new NextRequest(
        "https://example.com/api/venues?page=2&limit=20",
      );
      const res = await GET(req);
      expect(res.status).toBe(200);

      // Verify Prisma received positive safe skip & take values
      expect(prisma.venue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
        }),
      );
    });
  });
});
