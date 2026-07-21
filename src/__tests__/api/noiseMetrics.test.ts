import { GET, POST } from "@/app/api/venues/[venueId]/noise-metrics/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    user: {
      upsert: jest.fn(),
    },
    venueRating: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "test-user-123" }),
}));

describe("GET /api/venues/[venueId]/noise-metrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 if venue is not found", async () => {
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/venues/invalid/noise-metrics"),
      {
        params: Promise.resolve({ venueId: "invalid" }),
      },
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Venue not found");
  });

  it("returns noise metric buckets for valid venue", async () => {
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({ id: "v1" });
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([
      {
        avgDecibels: 42.5,
        peakDecibels: 50.0,
        createdAt: new Date("2026-01-01T09:00:00Z"),
      },
      {
        avgDecibels: 68.0,
        peakDecibels: 75.0,
        createdAt: new Date("2026-01-01T15:00:00Z"),
      },
    ]);

    const res = await GET(
      new Request("http://localhost/api/venues/v1/noise-metrics"),
      {
        params: Promise.resolve({ venueId: "v1" }),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.venueId).toBe("v1");
    expect(data.buckets).toHaveLength(4);
    expect(data.totalSamples).toBe(2);
  });
});

describe("POST /api/venues/[venueId]/noise-metrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 for out-of-bounds decibel readings (< 30 or > 90)", async () => {
    const resUnder = await POST(
      new Request("http://localhost/api/venues/v1/noise-metrics", {
        method: "POST",
        body: JSON.stringify({ decibels: 20 }),
      }),
      { params: Promise.resolve({ venueId: "v1" }) },
    );
    expect(resUnder.status).toBe(400);

    const resOver = await POST(
      new Request("http://localhost/api/venues/v1/noise-metrics", {
        method: "POST",
        body: JSON.stringify({ decibels: 95 }),
      }),
      { params: Promise.resolve({ venueId: "v1" }) },
    );
    expect(resOver.status).toBe(400);
  });

  it("records noise telemetry and updates venue for valid reading", async () => {
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({ id: "v1" });
    (prisma.user.upsert as jest.Mock).mockResolvedValue({});
    (prisma.venueRating.upsert as jest.Mock).mockResolvedValue({});
    (prisma.venue.update as jest.Mock).mockResolvedValue({});
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([
      { avgDecibels: 55, peakDecibels: 60, createdAt: new Date() },
    ]);

    const res = await POST(
      new Request("http://localhost/api/venues/v1/noise-metrics", {
        method: "POST",
        body: JSON.stringify({ decibels: 55 }),
      }),
      { params: Promise.resolve({ venueId: "v1" }) },
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.decibels).toBe(55);
    expect(data.noiseLevel).toBe("moderate");
    expect(prisma.venueRating.upsert).toHaveBeenCalled();
  });
});
