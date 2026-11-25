import { GET } from "@/app/api/map/heatmap/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findMany: jest.fn(),
    },
    booking: {
      groupBy: jest.fn(),
    },
    venueRating: {
      groupBy: jest.fn(),
    },
  },
}));

describe("Heatmap Noise Score Aggregation (#9858)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calculates per-venue noise scores without bias from global rating limits", async () => {
    // 3 venues: Venue 1 (popular), Venue 2 (moderate), Venue 3 (unrated)
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([
      { id: "v-1", latitude: 40.71, longitude: -74.0 },
      { id: "v-2", latitude: 35.68, longitude: 139.76 },
      { id: "v-3", latitude: 51.5, longitude: -0.12 },
    ]);

    // Active bookings
    (prisma.booking.groupBy as jest.Mock).mockResolvedValue([
      { venueId: "v-1", _count: { id: 2 } }, // booking contribution: 2 * 0.2 = 0.4
      { venueId: "v-2", _count: { id: 0 } },
    ]);

    // Grouped ratings by venue and noise level
    // Venue 1 has 100 loud ratings
    // Venue 2 has 2 quiet ratings and 2 moderate ratings (50% quiet, 50% moderate)
    // Venue 3 has 0 ratings
    (prisma.venueRating.groupBy as jest.Mock).mockResolvedValue([
      { venueId: "v-1", noiseLevel: "loud", _count: { id: 100 } },
      { venueId: "v-2", noiseLevel: "quiet", _count: { id: 2 } },
      { venueId: "v-2", noiseLevel: "moderate", _count: { id: 2 } },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(3);

    const [point1, point2, point3] = json.data;

    // Venue 1:
    // bookingCount = 2 -> 0.1 + 2 * 0.2 = 0.5
    // noiseScore: 100% loud -> 0.1 + (1.0 * 0.4 + 0.0 * 0.2) = 0.5
    // total weight = 0.5 + 0.5 = 1.0 (clamped to 1.0)
    expect(point1).toEqual([40.71, -74.0, 1.0]);

    // Venue 2:
    // bookingCount = 0 -> 0.1 + 0 = 0.1
    // noiseScore: total = 4. loud = 0/4 = 0. moderate = 2/4 = 0.5. quiet = 2/4 = 0.5.
    // noiseScore = 0.1 + (0 * 0.4 + 0.5 * 0.2) = 0.1 + 0.1 = 0.2
    // total weight = 0.1 + 0 + 0.2 = 0.3
    expect(point2).toEqual([35.68, 139.76, 0.3]);

    // Venue 3 (unrated):
    // bookingCount = 0 -> 0.1
    // noiseScore: baseline fallback = 0.2
    // total weight = 0.1 + 0 + 0.2 = 0.3
    expect(point3).toEqual([51.5, -0.12, 0.3]);

    // Verify prisma.venueRating.groupBy was called instead of findMany with take: 100
    expect(prisma.venueRating.groupBy).toHaveBeenCalledWith({
      by: ["venueId", "noiseLevel"],
      _count: { id: true },
    });
  });

  it("evaluates venues with 100% quiet ratings properly", async () => {
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([
      { id: "v-quiet", latitude: 10.0, longitude: 20.0 },
    ]);
    (prisma.booking.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.venueRating.groupBy as jest.Mock).mockResolvedValue([
      { venueId: "v-quiet", noiseLevel: "quiet", _count: { id: 10 } },
    ]);

    const res = await GET();
    const json = await res.json();

    // 100% quiet: loudRatio = 0, moderateRatio = 0 -> noiseScore = 0.1 + 0 = 0.1
    // weight = 0.1 (base) + 0 (bookings) + 0.1 (noise) = 0.2
    expect(json.data[0]).toEqual([10.0, 20.0, 0.2]);
  });

  it("returns HTTP 500 when database query fails", async () => {
    (prisma.venue.findMany as jest.Mock).mockRejectedValueOnce(
      new Error("Database connection failed"),
    );

    const res = await GET();
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Internal Server Error");
  });
});
