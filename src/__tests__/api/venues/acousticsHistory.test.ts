/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/venues/[venueId]/acoustics/history/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findFirst: jest.fn() },
    venueRating: { findMany: jest.fn() },
  },
}));

const mocked = {
  venue: prisma.venue.findFirst as unknown as jest.Mock,
  ratings: prisma.venueRating.findMany as unknown as jest.Mock,
};

const call = (query = "", venueId = "venue-1", headers: Record<string, string> = {}) =>
  GET(
    new NextRequest(`http://localhost/api/venues/${venueId}/acoustics/history${query}`, {
      headers,
    }),
    {
      params: Promise.resolve({ venueId }),
    }
  );

describe("GET /api/venues/[venueId]/acoustics/history (#10005)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.venue.mockResolvedValue({ id: "venue-1", name: "Quiet Study Hub" });
    mocked.ratings.mockResolvedValue([]);
  });

  it("returns 404 when venue does not exist", async () => {
    mocked.venue.mockResolvedValueOnce(null);
    const res = await call("", "non-existent-venue");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("VENUE_NOT_FOUND");
  });

  it("returns JSON acoustics history by default", async () => {
    mocked.ratings.mockResolvedValueOnce([
      {
        createdAt: new Date("2026-11-24T08:00:00Z"),
        avgDecibels: 42,
        peakDecibels: 55,
      },
      {
        createdAt: new Date("2026-11-24T09:00:00Z"),
        avgDecibels: 58,
        peakDecibels: 72,
      },
    ]);

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.venueId).toBe("venue-1");
    expect(body.total).toBe(2);
    expect(body.history).toHaveLength(2);
    expect(body.history[0].average_db).toBe(42);
    expect(body.history[0].dominant_frequency_hz).toBe(500);
  });

  it("returns CSV file when format=csv is queried", async () => {
    mocked.ratings.mockResolvedValueOnce([
      {
        createdAt: new Date("2026-11-24T08:00:00Z"),
        avgDecibels: 42,
        peakDecibels: 55,
      },
    ]);

    const res = await call("?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("venue-venue-1-noise-history-");

    const text = await res.text();
    expect(text).toContain("timestamp,average_db,peak_db,dominant_frequency_hz,quiet_score");
    expect(text).toContain("2026-11-24T08:00:00.000Z,42,55,500");
  });

  it("returns CSV when Accept: text/csv header is passed", async () => {
    mocked.ratings.mockResolvedValueOnce([]);
    const res = await call("", "venue-1", { accept: "text/csv" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  });
});
