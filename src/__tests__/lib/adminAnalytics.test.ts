import { getAdminAnalytics } from "@/lib/adminAnalytics";
import { prisma } from "@/lib/prisma";
import { getAnalyticsSummaryAsync } from "@/lib/analytics";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: jest.fn(),
    },
    booking: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    venueRating: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    conversation: {
      findMany: jest.fn(),
    },
    venue: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/analytics", () => ({
  getAnalyticsSummaryAsync: jest.fn(),
}));

describe("getAdminAnalytics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should run queries using Prisma aggregations and correctly structure the analytics response", async () => {
    // 1. Mock telemetry
    const mockTelemetry = {
      recentEvents: [
        {
          name: "venue_viewed",
          properties: { venueId: "venue-1" },
          timestamp: Date.now(),
        },
        {
          name: "agent_completed",
          properties: { durationMs: 1200, success: true },
          timestamp: Date.now(),
        },
      ],
      eventCounts: { venue_viewed: 1, agent_completed: 1 },
    };
    (getAnalyticsSummaryAsync as jest.Mock).mockResolvedValue(mockTelemetry);

    // 2. Mock users count
    (prisma.user.count as jest.Mock).mockResolvedValue(100);

    // 3. Mock booking groupBy
    (prisma.booking.groupBy as jest.Mock).mockResolvedValue([
      { venueId: "venue-1", _count: { _all: 5 } },
    ]);

    // 4. Mock rating groupBy
    (prisma.venueRating.groupBy as jest.Mock).mockResolvedValue([
      { venueId: "venue-1", _avg: { wifiQuality: 4.5 } },
    ]);

    // 5. Mock booking findMany for trends
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([
      { createdAt: new Date() },
    ]);

    // 6. Mock rating findMany for trends
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([
      { createdAt: new Date(), wifiQuality: 4 },
    ]);

    // 7. Mock active conversations (distinct users)
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);

    // 8. Mock total non-cancelled bookings count
    (prisma.booking.count as jest.Mock).mockResolvedValue(12);

    // 9. Mock venues findMany (active venues)
    const mockActiveVenues = [
      { id: "venue-1", name: "Cool Work Cafe", category: "cafe", rating: 4.2 },
    ];
    // Mock additional venues to reach 10
    const mockAdditionalVenues = Array.from({ length: 9 }).map((_, i) => ({
      id: `venue-additional-${i}`,
      name: `Additional Venue ${i}`,
      category: "library",
      rating: 4.0,
    }));

    (prisma.venue.findMany as jest.Mock)
      .mockResolvedValueOnce(mockActiveVenues) // first call for active venues
      .mockResolvedValueOnce(mockAdditionalVenues); // second call for additional venues

    const result = await getAdminAnalytics("30d");

    // Verification
    expect(result.range).toBe("30d");
    expect(result.overview.activeUsers).toBe(2);
    expect(result.overview.totalUsers).toBe(100);
    expect(result.overview.bookings).toBe(12);
    expect(result.overview.averageResolutionMs).toBe(1200);
    expect(result.overview.agentSuccessRate).toBe(100);

    // Verify leaderboard calculations
    expect(result.venueLeaderboard.length).toBe(10);
    const topVenue = result.venueLeaderboard.find((v) => v.id === "venue-1");
    expect(topVenue).toBeDefined();
    if (topVenue) {
      // score = views (1) * 1 + bookings (5) * 4 + averageRating (4.5) * 2 = 1 + 20 + 9 = 30
      expect(topVenue.score).toBe(30);
      expect(topVenue.rating).toBe(4.5);
    }

    // Verify database calls
    expect(prisma.booking.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["venueId"],
        where: expect.objectContaining({
          status: { not: "CANCELLED" },
        }),
      }),
    );
    expect(prisma.venueRating.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["venueId"],
      }),
    );
  });
});
