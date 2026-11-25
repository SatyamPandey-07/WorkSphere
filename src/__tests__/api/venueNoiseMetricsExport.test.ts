/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, MAX_ROWS_PER_SOURCE } from "@/app/api/venues/[venueId]/noise-metrics/export/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findFirst: jest.fn() },
    venueRating: { findMany: jest.fn() },
    wifiTelemetry: { findMany: jest.fn() },
  },
}));

const mocked = {
  auth: auth as unknown as jest.Mock,
  venue: prisma.venue.findFirst as unknown as jest.Mock,
  ratings: prisma.venueRating.findMany as unknown as jest.Mock,
  wifi: prisma.wifiTelemetry.findMany as unknown as jest.Mock,
};

const call = (query = "", venueId = "venue-1") =>
  GET(new NextRequest(`http://localhost/api/venues/${venueId}/noise-metrics/export${query}`), {
    params: Promise.resolve({ venueId }),
  });

describe("GET /api/venues/[venueId]/noise-metrics/export (#7674)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.auth.mockResolvedValue({ userId: "user-1" });
    mocked.venue.mockResolvedValue({ id: "venue-1" });
    mocked.ratings.mockResolvedValue([]);
    mocked.wifi.mockResolvedValue([]);
  });

  it("requires authentication", async () => {
    mocked.auth.mockResolvedValueOnce({ userId: null });
    const res = await call();
    expect(res.status).toBe(401);
    expect(mocked.venue).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown venue", async () => {
    mocked.venue.mockResolvedValueOnce(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("VENUE_NOT_FOUND");
  });

  it("rejects malformed dates through parseBookingDateFilter", async () => {
    const res = await call("?startDate=not-a-date");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0].field).toBe("startDate");
    expect(mocked.ratings).not.toHaveBeenCalled();
  });

  it("rejects startDate after endDate and ranges over 366 days", async () => {
    expect((await call("?startDate=2026-11-10&endDate=2026-11-01")).status).toBe(400);
    const tooLong = await call("?startDate=2024-01-01&endDate=2026-01-01");
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toMatch(/366 days/);
  });

  it("returns a CSV attachment with the required headers and rows", async () => {
    mocked.ratings.mockResolvedValueOnce([
      { createdAt: new Date("2026-11-10T08:00:00Z"), avgDecibels: 48.5, peakDecibels: 70 },
    ]);
    mocked.wifi.mockResolvedValueOnce([
      { timestamp: new Date("2026-11-10T09:00:00Z"), latency: 31, crowdLevel: "busy" },
    ]);

    const res = await call("?startDate=2026-11-01&endDate=2026-11-10");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="venue-venue-1-noise-metrics.csv"',
    );
    expect(res.headers.get("X-Export-Truncated")).toBeNull();

    expect((await res.text()).split("\r\n")).toEqual([
      "timestamp,venueId,avgDecibels,peakDecibels,crowdDensityScore,wifiLatencyMs",
      "2026-11-10T08:00:00.000Z,venue-1,48.5,70,,",
      "2026-11-10T09:00:00.000Z,venue-1,,,75,31",
      "",
    ]);
  });

  it("returns only the header row when there is no data", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      "timestamp,venueId,avgDecibels,peakDecibels,crowdDensityScore,wifiLatencyMs\r\n",
    );
  });

  it("filters both sources by the date range and treats a date-only endDate as the whole day", async () => {
    await call("?startDate=2026-11-01&endDate=2026-11-10");
    const gte = new Date("2026-11-01T00:00:00.000Z");
    const lte = new Date("2026-11-10T23:59:59.999Z");
    expect(mocked.ratings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ venueId: "venue-1", createdAt: { gte, lte } }),
      }),
    );
    expect(mocked.wifi).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ venueId: "venue-1", timestamp: { gte, lte } }),
      }),
    );
  });

  it("defaults to the last 30 days when no dates are given", async () => {
    const before = Date.now();
    await call();
    const where = mocked.wifi.mock.calls[0][0].where.timestamp;
    const spanDays = (where.lte.getTime() - where.gte.getTime()) / 86_400_000;
    expect(spanDays).toBeCloseTo(30, 5);
    expect(where.lte.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("flags truncated exports and caps each source", async () => {
    const many = Array.from({ length: MAX_ROWS_PER_SOURCE + 1 }, (_, i) => ({
      timestamp: new Date(1_700_000_000_000 + i * 1000),
      latency: 10,
      crowdLevel: "low",
    }));
    mocked.wifi.mockResolvedValueOnce(many);
    const res = await call();
    expect(res.headers.get("X-Export-Truncated")).toBe("true");
    const lines = (await res.text()).split("\r\n");
    expect(lines).toHaveLength(MAX_ROWS_PER_SOURCE + 2); // header + rows + trailing empty
  });

  it("returns 500 when the database fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mocked.wifi.mockRejectedValueOnce(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});
