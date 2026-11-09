import { GET, clampForecastOccupancy } from "@/app/api/venues/[venueId]/seating-forecast/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
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

describe("GET /api/venues/[venueId]/seating-forecast", () => {
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

  it("returns bounded forecast values for all 24 hours", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-123",
      maxCapacity: 60,
    });

    const res = await GET(
      new Request("http://localhost/api/venues/venue-123/seating-forecast"),
      {
        params: Promise.resolve({ venueId: "venue-123" }),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.capacity).toBe(60);
    expect(data.forecast).toHaveLength(24);
    expect(Array.isArray(data.recommendedHours)).toBe(true);

    data.forecast.forEach(
      (item: {
        hour: number;
        predictedOccupancy: number;
        occupancyPercentage: number;
        capacity: number;
      }) => {
        expect(item.occupancyPercentage).toBeGreaterThanOrEqual(0);
        expect(item.occupancyPercentage).toBeLessThanOrEqual(100);
        expect(item.predictedOccupancy).toBeGreaterThanOrEqual(0);
        expect(item.predictedOccupancy).toBeLessThanOrEqual(data.capacity);
      },
    );
  });
});
