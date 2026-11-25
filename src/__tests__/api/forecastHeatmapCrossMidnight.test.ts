import {
  GET,
  isBookingActiveAtHour,
  parseBookingInterval,
} from "@/app/api/map/forecast-heatmap/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    venueSeat: {
      findMany: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    venueRating: {
      findMany: jest.fn(),
    },
  },
}));

describe("Forecast Heatmap Cross-Midnight Bookings (#9857)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("parseBookingInterval", () => {
    it("parses valid date and time into UTC start and end millisecond timestamps", () => {
      const interval = parseBookingInterval({
        date: "2026-11-24",
        time: "23:30",
        duration: 120,
        seatId: "seat-1",
      });

      expect(interval).not.toBeNull();
      expect(interval?.startMs).toBe(Date.parse("2026-11-24T23:30:00Z"));
      expect(interval?.endMs).toBe(Date.parse("2026-11-25T01:30:00Z"));
    });

    it("returns null for malformed time or duration", () => {
      expect(
        parseBookingInterval({
          date: "2026-11-24",
          time: "invalid",
          duration: 60,
          seatId: null,
        }),
      ).toBeNull();

      expect(
        parseBookingInterval({
          date: "2026-11-24",
          time: "10:00",
          duration: 0,
          seatId: null,
        }),
      ).toBeNull();
    });
  });

  describe("isBookingActiveAtHour", () => {
    const overnightBooking = {
      date: "2026-11-24",
      time: "23:00",
      duration: 180, // 23:00 to 02:00 next day
      seatId: "seat-a",
    };

    it("marks booking active on the starting date at hour 23", () => {
      expect(isBookingActiveAtHour(overnightBooking, "2026-11-24", 23)).toBe(
        true,
      );
    });

    it("marks booking active past midnight on the following date at hour 0 (00:00 - 01:00)", () => {
      expect(isBookingActiveAtHour(overnightBooking, "2026-11-25", 0)).toBe(
        true,
      );
    });

    it("marks booking active past midnight on the following date at hour 1 (01:00 - 02:00)", () => {
      expect(isBookingActiveAtHour(overnightBooking, "2026-11-25", 1)).toBe(
        true,
      );
    });

    it("does not mark booking active before start or after conclusion", () => {
      // 22:00 on starting date is before start
      expect(isBookingActiveAtHour(overnightBooking, "2026-11-24", 22)).toBe(
        false,
      );
      // 02:00 on following date is after conclusion
      expect(isBookingActiveAtHour(overnightBooking, "2026-11-25", 2)).toBe(
        false,
      );
      // Different date entirely
      expect(isBookingActiveAtHour(overnightBooking, "2026-11-26", 0)).toBe(
        false,
      );
    });
  });

  describe("GET /api/map/forecast-heatmap route with cross-midnight bookings", () => {
    it("accounts for overnight bookings in hourly occupancy across calendar days", async () => {
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
        id: "venue-night",
      });

      // 2 seats in venue
      (prisma.venueSeat.findMany as jest.Mock).mockResolvedValue([
        { id: "seat-1" },
        { id: "seat-2" },
      ]);

      // Booking spanning across midnight: starts 2026-11-24 at 23:00 for 120 min on seat-1
      (prisma.booking.findMany as jest.Mock).mockResolvedValue([
        {
          date: "2026-11-24",
          time: "23:00",
          duration: 120, // Ends 2026-11-25 at 01:00
          seatId: "seat-1",
        },
      ]);

      const req = new Request(
        "http://localhost:3000/api/map/forecast-heatmap?venueId=venue-night&startDate=2026-11-24",
      );

      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.capacity).toBe(2);

      // Verify Prisma queried from addDays(startDate, -1) to capture prior evening bookings
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            venueId: "venue-night",
            date: {
              gte: "2026-11-23",
              lte: "2026-11-30",
            },
          }),
        }),
      );

      // On 2026-11-24 at hour 23: 1 of 2 seats occupied = 50%
      const day1Hour23 = json.data.find(
        (d: any) => d.date === "2026-11-24" && d.hour === 23,
      );
      expect(day1Hour23.occupancy).toBe(50);

      // On 2026-11-25 at hour 0 (00:00 - 01:00): 1 of 2 seats occupied = 50%
      const day2Hour0 = json.data.find(
        (d: any) => d.date === "2026-11-25" && d.hour === 0,
      );
      expect(day2Hour0.occupancy).toBe(50);

      // On 2026-11-25 at hour 1 (01:00 - 02:00): booking ended at 01:00, 0% occupied
      const day2Hour1 = json.data.find(
        (d: any) => d.date === "2026-11-25" && d.hour === 1,
      );
      expect(day2Hour1.occupancy).toBe(0);
    });
  });
});
