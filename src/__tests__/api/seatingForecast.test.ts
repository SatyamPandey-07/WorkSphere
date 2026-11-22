import {
  GET,
  clampForecastOccupancy,
} from "@/app/api/venues/[venueId]/seating-forecast/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
    },
  },
}));

describe("clampForecastOccupancy (#4920)", () => {
  it("clamps forecast values > 100 to 100", () => {
    expect(clampForecastOccupancy(105)).toBe(100);
    expect(clampForecastOccupancy(150.5)).toBe(100);
    expect(clampForecastOccupancy(999)).toBe(100);
    expect(clampForecastOccupancy(Infinity)).toBe(100);
  });

  it("clamps forecast values < 0 to 0", () => {
    expect(clampForecastOccupancy(-5)).toBe(0);
    expect(clampForecastOccupancy(-25.8)).toBe(0);
    expect(clampForecastOccupancy(-999)).toBe(0);
    expect(clampForecastOccupancy(-Infinity)).toBe(0);
  });

  it("leaves valid forecast values within [0, 100] unchanged", () => {
    expect(clampForecastOccupancy(0)).toBe(0);
    expect(clampForecastOccupancy(45.5)).toBe(45.5);
    expect(clampForecastOccupancy(80)).toBe(80);
    expect(clampForecastOccupancy(100)).toBe(100);
  });

  it("returns 0 for NaN or invalid input types", () => {
    expect(clampForecastOccupancy(NaN)).toBe(0);
    expect(clampForecastOccupancy(undefined as unknown as number)).toBe(0);
    expect(clampForecastOccupancy("invalid" as unknown as number)).toBe(0);
  });
});

describe("GET /api/venues/[venueId]/seating-forecast (Issue #9517)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 if venue is not found", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/venues/invalid-venue/seating-forecast"),
      {
        params: Promise.resolve({ venueId: "invalid-venue" }),
      },
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Venue not found");
  });

  it("returns transparent baseline with low confidence when venue has no booking history", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-123",
      maxCapacity: 50,
      _count: { seats: 20 },
    });
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/venues/venue-123/seating-forecast"),
      {
        params: Promise.resolve({ venueId: "venue-123" }),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.capacity).toBe(20); // Derived from configured seats
    expect(data.forecast).toHaveLength(24);
    expect(data.forecast[0].dataSource).toBe("INSUFFICIENT_DATA");
    expect(data.forecast[0].confidence).toBe(0.1);
    expect(data.forecast[0].predictedOccupancy).toBe(0);
  });

  it("calculates real scheduled occupancy respecting booking duration overlap", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-123",
      maxCapacity: 40,
      _count: { seats: 0 },
    });

    const targetDate = "2026-11-25";
    // Booking from 10:00 with 120 min duration covers hour 10 and hour 11
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([
      {
        date: targetDate,
        time: "10:00",
        duration: 120,
      },
      {
        date: targetDate,
        time: "11:30",
        duration: 60,
      },
    ]);

    const res = await GET(
      new Request(
        `http://localhost/api/venues/venue-123/seating-forecast?date=${targetDate}`,
      ),
      {
        params: Promise.resolve({ venueId: "venue-123" }),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();

    const hour9 = data.forecast.find((f: any) => f.hour === 9);
    const hour10 = data.forecast.find((f: any) => f.hour === 10);
    const hour11 = data.forecast.find((f: any) => f.hour === 11);
    const hour12 = data.forecast.find((f: any) => f.hour === 12);

    expect(hour9.predictedOccupancy).toBe(0);
    expect(hour10.predictedOccupancy).toBe(1); // First booking active
    expect(hour11.predictedOccupancy).toBe(2); // Both bookings overlap in hour 11
    expect(hour12.predictedOccupancy).toBe(1); // Second booking extends until 12:30
  });

  it("averages historical utilization for the same day-of-week and orders recommended hours", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-123",
      maxCapacity: 50,
      _count: { seats: 50 },
    });

    // 2026-11-25 is a Wednesday. Provide historical Wednesdays.
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([
      // Wednesday 2026-11-18: 2 bookings at 14:00
      { date: "2026-11-18", time: "14:00", duration: 60 },
      { date: "2026-11-18", time: "14:00", duration: 60 },
      // Wednesday 2026-11-11: 4 bookings at 14:00
      { date: "2026-11-11", time: "14:00", duration: 60 },
      { date: "2026-11-11", time: "14:00", duration: 60 },
      { date: "2026-11-11", time: "14:00", duration: 60 },
      { date: "2026-11-11", time: "14:00", duration: 60 },
    ]);

    const res = await GET(
      new Request(
        "http://localhost/api/venues/venue-123/seating-forecast?date=2026-11-25",
      ),
      {
        params: Promise.resolve({ venueId: "venue-123" }),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();

    const hour14 = data.forecast.find((f: any) => f.hour === 14);
    // Average of 2 days = (2 + 4) / 2 = 3
    expect(hour14.predictedOccupancy).toBe(3);
    expect(hour14.dataSource).toBe("HISTORICAL_AVERAGE");
    expect(hour14.confidence).toBeGreaterThan(0.2);

    // Recommended hours should be among business hours with lowest occupancy
    expect(data.recommendedHours).toHaveLength(3);
    expect(data.recommendedHours.every((h: number) => h >= 9 && h <= 17)).toBe(
      true,
    );
  });
});
