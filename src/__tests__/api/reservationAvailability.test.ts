/**
 * @jest-environment node
 */
import { GET } from "@/app/api/reservations/availability/route";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

jest.mock("@/lib/reservations/seed-layout", () => ({
  ensureVenueLayout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findUnique: jest.fn() },
    venueSeat: { findMany: jest.fn() },
    booking: { findMany: jest.fn() },
  },
}));

const SEATS = [
  { id: "s1", venueId: "v1", seatNumber: "A1" },
  { id: "s2", venueId: "v1", seatNumber: "A2" },
];

function call(params: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/reservations/availability");
  for (const [k, v] of Object.entries({ venueId: "v1", ...params })) {
    url.searchParams.set(k, v);
  }
  return GET(new NextRequest(url));
}

function stubBookings(rows: Record<string, unknown>[]) {
  (prisma.booking.findMany as jest.Mock).mockResolvedValue(rows);
}

async function availability(params: Record<string, string>) {
  const res = await call(params);
  const body = await res.json();
  return {
    res,
    body,
    map: Object.fromEntries(
      (body.seats ?? []).map((s: any) => [s.id, s.available]),
    ),
  };
}

describe("GET /api/reservations/availability", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "v1",
      name: "Venue",
      address: null,
      category: "coworking",
    });
    (prisma.venueSeat.findMany as jest.Mock).mockResolvedValue(SEATS);
    stubBookings([]);
  });

  describe("input validation", () => {
    it.each([
      ["unparseable time", { date: "2026-10-10", time: "banana" }],
      ["out-of-range time", { date: "2026-10-10", time: "99:99" }],
      ["impossible date", { date: "2026-02-31", time: "10:00" }],
      ["non-integer duration", { date: "2026-10-10", time: "10:00", duration: "60.5" }],
      ["duration over 8 hours", { date: "2026-10-10", time: "10:00", duration: "600" }],
    ])("returns 400 for %s instead of showing every seat as free", async (_n, params) => {
      const { res, body } = await availability(params);
      expect(res.status).toBe(400);
      expect(body.error).toBeDefined();
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it("keeps the existing 400 for missing parameters", async () => {
      const { res } = await availability({ date: "2026-10-10" });
      expect(res.status).toBe(400);
    });

    it("accepts a 12-hour time and echoes the normalised value", async () => {
      const { res, body } = await availability({ date: "2026-10-10", time: "9:05 AM" });
      expect(res.status).toBe(200);
      expect(body.time).toBe("09:05");
    });

    it("falls back to UTC for an invalid timeZone", async () => {
      const { body } = await availability({
        date: "2026-10-10",
        time: "10:00",
        timeZone: "Not/AZone",
      });
      expect(body.timeZone).toBe("UTC");
    });
  });

  describe("conflict detection", () => {
    it("marks only the seat with an overlapping booking unavailable", async () => {
      stubBookings([
        { seatId: "s1", date: "2026-10-10", time: "10:00", duration: 60, timeZone: "UTC" },
      ]);
      const { map } = await availability({ date: "2026-10-10", time: "10:30" });
      expect(map).toEqual({ s1: false, s2: true });
    });

    it("treats back-to-back bookings as available", async () => {
      stubBookings([
        { seatId: "s1", date: "2026-10-10", time: "10:00", duration: 60, timeZone: "UTC" },
      ]);
      const { map } = await availability({ date: "2026-10-10", time: "11:00" });
      expect(map.s1).toBe(true);
    });

    it("sees a booking that runs past midnight from the next day", async () => {
      stubBookings([
        { seatId: "s1", date: "2026-10-10", time: "23:00", duration: 120, timeZone: "UTC" },
      ]);
      const { map } = await availability({ date: "2026-10-11", time: "00:30" });
      expect(map.s1).toBe(false);
    });

    it("compares real instants across timezones", async () => {
      stubBookings([
        { seatId: "s1", date: "2026-10-10", time: "09:00", duration: 60, timeZone: "Asia/Colombo" },
      ]);
      const same = await availability({
        date: "2026-10-10",
        time: "03:30",
        timeZone: "UTC",
      });
      expect(same.map.s1).toBe(false);

      const differentInstant = await availability({
        date: "2026-10-10",
        time: "09:00",
        timeZone: "UTC",
      });
      expect(differentInstant.map.s1).toBe(true);
    });

    it("honours legacy rows stored as 12-hour times", async () => {
      stubBookings([
        { seatId: "s1", date: "2026-10-10", time: "10:00 AM", duration: null, timeZone: null },
      ]);
      const { map } = await availability({ date: "2026-10-10", time: "10:15" });
      expect(map.s1).toBe(false);
    });

    it("queries a window of dates, not just the requested one", async () => {
      await availability({ date: "2026-10-10", time: "10:00" });
      const where = (prisma.booking.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.date.in).toEqual(
        expect.arrayContaining(["2026-10-09", "2026-10-10", "2026-10-11"]),
      );
      expect(where.venueId).toBe("v1");
    });
  });
});
