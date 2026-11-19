import { GET } from "@/app/api/venues/[venueId]/noise-metrics/forecast/route";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findFirst: jest.fn() },
    venueRating: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(),
}));

const mockFindVenue = prisma.venue.findFirst as jest.Mock;
const mockFindRatings = prisma.venueRating.findMany as jest.Mock;
const mockGetRedis = getRedis as jest.Mock;

describe("GET /api/venues/[venueId]/noise-metrics/forecast", () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRedis.mockReturnValue(redis);
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue("OK");
    mockFindVenue.mockResolvedValue({ id: "venue-1" });
    mockFindRatings.mockResolvedValue([
      { avgDecibels: 42, createdAt: new Date() },
      { avgDecibels: 48, createdAt: new Date() },
    ]);
  });

  it("returns 404 for an unknown venue", async () => {
    mockFindVenue.mockResolvedValue(null);
    const response = await GET(
      new Request("http://localhost/api/venues/missing/noise-metrics/forecast"),
      { params: Promise.resolve({ venueId: "missing" }) },
    );
    expect(response.status).toBe(404);
    expect(mockFindRatings).not.toHaveBeenCalled();
  });

  it("returns the legacy forecast and a full weekly matrix", async () => {
    const response = await GET(
      new Request("http://localhost/api/venues/venue-1/noise-metrics/forecast?tz=UTC"),
      { params: Promise.resolve({ venueId: "venue-1" }) },
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.venueId).toBe("venue-1");
    expect(data.forecast.forecast).toHaveLength(24);
    expect(data.weeklyForecast.matrix).toHaveLength(7);
    expect(data.weeklyForecast.matrix.every((day: unknown[]) => day.length === 24)).toBe(true);
    expect(response.headers.get("X-Noise-Forecast-Cache")).toBe("MISS");
    expect(mockFindRatings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          venueId: "venue-1",
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining("venue-noise-forecast"),
      expect.objectContaining({ weeklyForecast: expect.any(Object) }),
      { ex: 3600 },
    );
  });

  it("isolates cached forecasts by requested timezone", async () => {
    const utcResponse = await GET(
      new Request("http://localhost/api/venues/venue-1/noise-metrics/forecast?tz=UTC"),
      { params: Promise.resolve({ venueId: "venue-1" }) },
    );
    const kolkataResponse = await GET(
      new Request("http://localhost/api/venues/venue-1/noise-metrics/forecast?tz=Asia%2FKolkata"),
      { params: Promise.resolve({ venueId: "venue-1" }) },
    );

    expect(utcResponse.status).toBe(200);
    expect(kolkataResponse.status).toBe(200);
    const readKeys = redis.get.mock.calls.map(([key]) => key);
    const writeKeys = redis.set.mock.calls.map(([key]) => key);
    expect(readKeys).toHaveLength(2);
    expect(writeKeys).toHaveLength(2);
    expect(readKeys[0]).toContain(":UTC");
    expect(readKeys[1]).toContain(":Asia/Kolkata");
    expect(readKeys[0]).not.toBe(readKeys[1]);
    expect(writeKeys[0]).not.toBe(writeKeys[1]);
  });

  it("serves a cached weekly forecast without re-querying telemetry", async () => {
    const cached = { venueId: "venue-1", weeklyForecast: { matrix: [] } };
    redis.get.mockResolvedValue(cached);

    const response = await GET(
      new Request("http://localhost/api/venues/venue-1/noise-metrics/forecast"),
      { params: Promise.resolve({ venueId: "venue-1" }) },
    );
    expect(response.headers.get("X-Noise-Forecast-Cache")).toBe("HIT");
    expect(await response.json()).toEqual(cached);
    expect(mockFindRatings).not.toHaveBeenCalled();
  });

  it("still returns a forecast when Redis is unavailable", async () => {
    mockGetRedis.mockReturnValue(null);
    const response = await GET(
      new Request("http://localhost/api/venues/venue-1/noise-metrics/forecast"),
      { params: Promise.resolve({ venueId: "venue-1" }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Noise-Forecast-Cache")).toBe("MISS");
  });
});
