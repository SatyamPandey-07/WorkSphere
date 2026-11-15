/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import {
  GET,
  MAX_ROWS_PER_SOURCE,
} from "@/app/api/venues/[venueId]/telemetry/export/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findFirst: jest.fn() },
    venueRating: { findMany: jest.fn() },
    telemetryRecord: { findMany: jest.fn() },
    wifiTelemetry: { findMany: jest.fn() },
  },
}));

const mocked = {
  auth: auth as unknown as jest.Mock,
  venue: prisma.venue.findFirst as unknown as jest.Mock,
  ratings: prisma.venueRating.findMany as unknown as jest.Mock,
  records: prisma.telemetryRecord.findMany as unknown as jest.Mock,
  wifi: prisma.wifiTelemetry.findMany as unknown as jest.Mock,
};

const call = (query = "", venueId = "venue-1") =>
  GET(
    new NextRequest(`http://localhost/api/venues/${venueId}/telemetry/export${query}`),
    { params: Promise.resolve({ venueId }) },
  );

const HEADER = "timestamp,decibel_avg,decibel_peak,occupancy_ratio,wifi_speed_mbps";

describe("GET /api/venues/[venueId]/telemetry/export (#7732)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.auth.mockResolvedValue({ userId: "owner-1", sessionClaims: {} });
    mocked.venue.mockResolvedValue({
      id: "venue-1",
      ownerId: "owner-1",
      creatorId: "creator-1",
      maxCapacity: 40,
    });
    mocked.ratings.mockResolvedValue([]);
    mocked.records.mockResolvedValue([]);
    mocked.wifi.mockResolvedValue([]);
  });

  describe("validation and auth", () => {
    it("requires authentication", async () => {
      mocked.auth.mockResolvedValueOnce({ userId: null });
      const res = await call();
      expect(res.status).toBe(401);
      expect(mocked.venue).not.toHaveBeenCalled();
    });

    it("rejects unsupported formats", async () => {
      const res = await call("?format=xml");
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("VALIDATION_FAILED");
      expect(mocked.venue).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown venue", async () => {
      mocked.venue.mockResolvedValueOnce(null);
      const res = await call();
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("VENUE_NOT_FOUND");
    });

    it("rejects malformed dates, inverted ranges and ranges over 366 days", async () => {
      const bad = await call("?startDate=not-a-date");
      expect(bad.status).toBe(400);
      expect((await bad.json()).errors[0].field).toBe("startDate");

      expect((await call("?startDate=2026-11-10&endDate=2026-11-01")).status).toBe(400);

      const tooLong = await call("?startDate=2024-01-01&endDate=2026-01-01");
      expect(tooLong.status).toBe(400);
      expect((await tooLong.json()).error).toMatch(/366 days/);
      expect(mocked.ratings).not.toHaveBeenCalled();
    });
  });

  describe("CSV output", () => {
    it("returns a CSV attachment with the required headers and rows", async () => {
      mocked.ratings.mockResolvedValueOnce([
        { createdAt: new Date("2026-11-10T10:00:00Z"), avgDecibels: 48.5, peakDecibels: 70 },
      ]);
      mocked.records.mockResolvedValueOnce([
        { timestamp: new Date("2026-11-10T08:00:00Z"), noiseLevel: 44, occupancy: 10, download: 120 },
      ]);
      mocked.wifi.mockResolvedValueOnce([
        { timestamp: new Date("2026-11-10T09:00:00Z"), download: 90, crowdLevel: "busy" },
      ]);

      const res = await call("?format=csv&startDate=2026-11-01&endDate=2026-11-10");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="venue-telemetry-venue-1.csv"',
      );
      expect(res.headers.get("X-Telemetry-Anonymized")).toBe("false");
      expect(res.headers.get("X-Export-Truncated")).toBeNull();

      expect((await res.text()).split("\r\n")).toEqual([
        HEADER,
        "2026-11-10T08:00:00.000Z,44,,0.25,120",
        "2026-11-10T09:00:00.000Z,,,0.75,90",
        "2026-11-10T10:00:00.000Z,48.5,70,,",
        "",
      ]);
    });

    it("defaults to CSV and returns only the header when there is no data", async () => {
      const res = await call();
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(await res.text()).toBe(`${HEADER}\r\n`);
    });

    it("builds a safe filename from the venue id", async () => {
      mocked.venue.mockResolvedValueOnce({
        id: 'ven"ue/../1',
        ownerId: "owner-1",
        creatorId: null,
        maxCapacity: 40,
      });
      const res = await call();
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="venue-telemetry-ven_ue____1.csv"',
      );
    });
  });

  describe("JSON output", () => {
    it("returns the same rows as JSON with metadata", async () => {
      mocked.records.mockResolvedValueOnce([
        { timestamp: new Date("2026-11-10T08:00:00Z"), noiseLevel: 44, occupancy: 20, download: 120 },
      ]);
      const res = await call("?format=json&startDate=2026-11-01&endDate=2026-11-10");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="venue-telemetry-venue-1.json"',
      );

      expect(await res.json()).toEqual({
        venueId: "venue-1",
        anonymized: false,
        startDate: "2026-11-01T00:00:00.000Z",
        endDate: "2026-11-10T23:59:59.999Z",
        truncated: false,
        count: 1,
        data: [
          {
            timestamp: "2026-11-10T08:00:00.000Z",
            decibel_avg: 44,
            decibel_peak: null,
            occupancy_ratio: 0.5,
            wifi_speed_mbps: 120,
          },
        ],
      });
    });
  });

  describe("date range filtering", () => {
    it("filters all sources and treats a date-only endDate as the whole day", async () => {
      await call("?startDate=2026-11-01&endDate=2026-11-10");
      const gte = new Date("2026-11-01T00:00:00.000Z");
      const lte = new Date("2026-11-10T23:59:59.999Z");

      expect(mocked.ratings).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ venueId: "venue-1", createdAt: { gte, lte } }),
        }),
      );
      expect(mocked.records).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ venueId: "venue-1", timestamp: { gte, lte } }),
        }),
      );
      expect(mocked.wifi).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ venueId: "venue-1", timestamp: { gte, lte } }),
        }),
      );
    });

    it("keeps an exact endDate timestamp as given", async () => {
      await call("?startDate=2026-11-01T00:00:00Z&endDate=2026-11-10T12:00:00Z");
      const where = mocked.wifi.mock.calls[0][0].where.timestamp;
      expect(where.lte).toEqual(new Date("2026-11-10T12:00:00.000Z"));
    });

    it("defaults to the last 30 days when no dates are given", async () => {
      const before = Date.now();
      await call();
      const range = mocked.wifi.mock.calls[0][0].where.timestamp;
      const spanDays = (range.lte.getTime() - range.gte.getTime()) / 86_400_000;
      expect(spanDays).toBeCloseTo(30, 5);
      expect(range.lte.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe("access levels", () => {
    const samples = () => {
      mocked.records.mockResolvedValueOnce([
        { timestamp: new Date("2026-11-10T08:05:00Z"), noiseLevel: 40, occupancy: 10, download: 100 },
        { timestamp: new Date("2026-11-10T08:40:00Z"), noiseLevel: 45, occupancy: 20, download: 110 },
      ]);
    };

    it("returns anonymized hourly data to other signed in users", async () => {
      mocked.auth.mockResolvedValue({ userId: "someone-else", sessionClaims: {} });
      samples();
      const res = await call("?format=json");
      expect(res.headers.get("X-Telemetry-Anonymized")).toBe("true");
      const body = await res.json();
      expect(body.anonymized).toBe(true);
      expect(body.data).toEqual([
        {
          timestamp: "2026-11-10T08:00:00.000Z",
          decibel_avg: 42.5,
          decibel_peak: null,
          occupancy_ratio: 0.38,
          wifi_speed_mbps: 105,
        },
      ]);
    });

    it.each([
      ["the venue creator", { userId: "creator-1", sessionClaims: {} }],
      ["an admin role", { userId: "u", sessionClaims: { metadata: { role: "admin" } } }],
      ["a venue_manager role", { userId: "u", sessionClaims: { role: "venue_manager" } }],
    ])("returns raw samples to %s", async (_label, session) => {
      mocked.auth.mockResolvedValue(session);
      samples();
      const body = await (await call("?format=json")).json();
      expect(body.anonymized).toBe(false);
      expect(body.data).toHaveLength(2);
    });
  });

  it("flags truncated exports and caps each source", async () => {
    const many = Array.from({ length: MAX_ROWS_PER_SOURCE + 1 }, (_, i) => ({
      timestamp: new Date(1_700_000_000_000 + i * 1000),
      download: 10,
      crowdLevel: "low",
    }));
    mocked.wifi.mockResolvedValueOnce(many);
    const res = await call();
    expect(res.headers.get("X-Export-Truncated")).toBe("true");
    const lines = (await res.text()).split("\r\n");
    expect(lines).toHaveLength(MAX_ROWS_PER_SOURCE + 2);
  });

  it("returns 500 when the database fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mocked.wifi.mockRejectedValueOnce(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("INTERNAL_ERROR");
    spy.mockRestore();
  });
});
