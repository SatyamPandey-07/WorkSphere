/** @jest-environment node */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GET, POST } from "@/app/api/analytics/carbon-footprint/route";
import { prisma } from "@/lib/prisma";
import type { CarbonFootprintSummary } from "@/lib/sustainability/carbonEngine";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: jest.fn(),
    },
  },
}));

const mockAuth = auth as jest.Mock;
const mockFindMany = prisma.booking.findMany as jest.Mock;

function createGetRequest(query = ""): NextRequest {
  const url = query
    ? `http://localhost/api/analytics/carbon-footprint?${query}`
    : "http://localhost/api/analytics/carbon-footprint";
  return new NextRequest(url, { method: "GET" });
}

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/analytics/carbon-footprint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Issue #9581 - Carbon Footprint Analytics Authentication & Integrity", () => {
  const testUserId = "user_nomad_authenticated";

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: testUserId });
    mockFindMany.mockResolvedValue([]);
  });

  describe("GET /api/analytics/carbon-footprint", () => {
    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const res = await GET(createGetRequest());
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it("rejects cross-user queries when requested userId differs from session with 403 Forbidden", async () => {
      const res = await GET(createGetRequest("userId=user_victim_victim"));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/forbidden/i);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it("allows query parameter matching the authenticated session userId", async () => {
      const res = await GET(createGetRequest(`userId=${testUserId}`));
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: testUserId }),
        }),
      );
    });

    it("rejects invalid date range format with 400 Bad Request", async () => {
      const res = await GET(
        createGetRequest("startDate=invalid-date&endDate=2026-11-20"),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid date range/i);
    });

    it("rejects inverted date range (startDate > endDate) with 400 Bad Request", async () => {
      const res = await GET(
        createGetRequest("startDate=2026-11-25&endDate=2026-11-10"),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/startDate cannot be after endDate/i);
    });

    it("returns explicit INSUFFICIENT_DATA status and summary:null when no verified commute records exist", async () => {
      // User has bookings, but without verified commute tracking telemetry
      mockFindMany.mockResolvedValue([
        {
          id: "bk_1",
          confirmationId: "BK-1001",
          venueId: "ven_1",
          date: "2026-10-15",
          venue: { name: "City Hub Coworking", category: "Coworking" },
        },
      ]);

      const res = await GET(createGetRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe("INSUFFICIENT_DATA");
      expect(json.summary).toBeNull();
      expect(json.totalBookings).toBe(1);
      expect(json.message).toMatch(/no verified commute records/i);
    });

    it("strictly does not synthesize modulo commute data or return hardcoded sample trips", async () => {
      mockFindMany.mockResolvedValue([]);

      const res = await GET(createGetRequest());
      const json = await res.json();

      expect(json.status).toBe("INSUFFICIENT_DATA");
      expect(json.summary).toBeNull();

      // Ensure hardcoded sample trips from prior buggy implementation are not leaked
      const rawString = JSON.stringify(json);
      expect(rawString).not.toContain("Sightglass Artisan Coffee & Lab");
      expect(rawString).not.toContain("BK-78901");
      expect(rawString).not.toContain("BK-78902");
      expect(rawString).not.toContain("Factory Berlin Mitte");
    });

    it("correctly computes carbon summary when verified commute telemetry exists on bookings", async () => {
      mockFindMany.mockResolvedValue([
        {
          id: "bk_verified_1",
          confirmationId: "BK-REAL-001",
          venueId: "ven_1",
          date: "2026-10-12",
          commuteDistanceKm: 6.0,
          commuteMode: "BICYCLING",
          isGreenCertifiedVenue: true,
          venue: { name: "Solar Green Hub", category: "Eco" },
        },
        {
          id: "bk_verified_2",
          confirmationId: "BK-REAL-002",
          venueId: "ven_2",
          date: "2026-10-18",
          commuteDistanceKm: 12.0,
          commuteMode: "PUBLIC_TRANSIT",
          isGreenCertifiedVenue: false,
          venue: { name: "Metro Commons", category: "Standard" },
        },
      ]);

      const res = await GET(createGetRequest("month=October 2026"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe("AVAILABLE");
      expect(json.summary).not.toBeNull();
      expect(json.summary.totalDistanceKm).toBe(18.0);
      expect(json.summary.records).toHaveLength(2);
      expect(json.summary.records[0].bookingId).toBe("BK-REAL-001");
      expect(json.summary.records[0].commuteMode).toBe("BICYCLING");
    });

    it("passes date range filter to database query", async () => {
      await GET(createGetRequest("startDate=2026-10-01&endDate=2026-10-31"));

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: testUserId,
            date: {
              gte: "2026-10-01",
              lte: "2026-10-31",
            },
          }),
        }),
      );
    });
  });

  describe("POST /api/analytics/carbon-footprint - CSV & JSON Export", () => {
    const validSummary: CarbonFootprintSummary = {
      periodMonth: "October 2026",
      totalDistanceKm: 18.0,
      totalEmissionsKgCo2: 0.42,
      totalAvoidedKgCo2: 2.68,
      treesEquivalentOffset: 1.5,
      greenVenuesVisitedCount: 1,
      modeBreakdown: [],
      ecoBadgesEarned: [],
      records: [
        {
          bookingId: "BK-EXP-001",
          venueName: "Solar Green Hub",
          date: "2026-10-12",
          distanceKm: 18.0,
          commuteMode: "BICYCLING",
          emissionsGramsCo2: 0,
          avoidedGramsCo2: 3096,
          isGreenCertifiedVenue: true,
        },
      ],
    };

    it("rejects unauthenticated POST requests with 401 Unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const res = await POST(
        createPostRequest({ summary: validSummary, format: "csv" }),
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects missing summary payload with 400 Bad Request", async () => {
      const res = await POST(createPostRequest({ format: "csv" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/missing or invalid summary/i);
    });

    it("rejects summary without records array with 400 Bad Request", async () => {
      const res = await POST(
        createPostRequest({ summary: { periodMonth: "October 2026" } }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/records array is required/i);
    });

    it("rejects unsupported export format with 400 Bad Request", async () => {
      const res = await POST(
        createPostRequest({ summary: validSummary, format: "xml" }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid format/i);
    });

    it("returns CSV file with proper headers for valid CSV export", async () => {
      const res = await POST(
        createPostRequest({ summary: validSummary, format: "csv" }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
      expect(res.headers.get("Content-Disposition")).toContain(
        "WorkSphere-Scope3-ESG-Report-October-2026.csv",
      );

      const text = await res.text();
      expect(text).toContain("BK-EXP-001");
      expect(text).toContain("Solar Green Hub");
      expect(text).toContain("BICYCLING");
    });

    it("returns JSON report when format is json", async () => {
      const res = await POST(
        createPostRequest({ summary: validSummary, format: "json" }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.report.periodMonth).toBe("October 2026");
      expect(json.exportedAt).toBeDefined();
    });
  });
});
