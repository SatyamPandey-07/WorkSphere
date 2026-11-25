/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { GET } from "@/app/api/analytics/route";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    venueRating: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    booking: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    venue: {
      count: jest.fn(),
    },
  },
}));

const mockAuth = auth as jest.Mock;
const mockEnsureUserExists = ensureUserExists as jest.Mock;
const mockUserFindUnique = prisma.user.findUnique as jest.Mock;
const mockRatingCount = prisma.venueRating.count as jest.Mock;
const mockRatingFindMany = prisma.venueRating.findMany as jest.Mock;
const mockBookingGroupBy = prisma.booking.groupBy as jest.Mock;
const mockBookingFindMany = prisma.booking.findMany as jest.Mock;
const mockVenueCount = prisma.venue.count as jest.Mock;

describe("Issue #9835 - Replace Unbounded History Reads with Database Aggregates", () => {
  const testUserId = "user_analytics_aggregate_123";

  const defaultUser = {
    id: testUserId,
    email: "nomad@example.com",
    firstName: "Neural",
    lastName: "Nomad",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    accurateVotes: 12,
    bookings: [],
    favorites: [],
    ratings: [],
    _count: {
      bookings: 15,
      favorites: 4,
      ratings: 20,
      conversations: 2,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: testUserId });
    mockEnsureUserExists.mockResolvedValue(undefined);
    mockUserFindUnique.mockResolvedValue(defaultUser);

    mockRatingCount.mockImplementation(({ where }: { where: any }) => {
      if (where.wifiSpeed) {
        return Promise.resolve(4); // 4 verified speedtests
      }
      return Promise.resolve(20); // 20 total ratings
    });

    mockBookingGroupBy.mockResolvedValue([
      { venueId: "cafe_1" },
      { venueId: "cafe_2" },
      { venueId: "cafe_3" },
      { venueId: "cafe_4" },
      { venueId: "cafe_5" },
      { venueId: "cafe_6" },
    ]);

    mockVenueCount.mockResolvedValue(2); // 2 venues created

    mockRatingFindMany.mockResolvedValue([
      { createdAt: new Date("2026-05-01T22:30:00Z") }, // Night owl review (hour 22 >= 21)
      { createdAt: new Date("2026-05-02T14:00:00Z") },
    ]);
  });

  it("delegates count and distinct calculations to database aggregates instead of in-memory scans", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();

    // 1. Verify prisma.venueRating.count called for total reviews
    expect(mockRatingCount).toHaveBeenCalledWith({
      where: { userId: testUserId },
    });

    // 2. Verify prisma.venueRating.count called with wifiSpeed filter for speedtests
    expect(mockRatingCount).toHaveBeenCalledWith({
      where: {
        userId: testUserId,
        wifiSpeed: { gt: 0 },
      },
    });

    // 3. Verify prisma.booking.groupBy called for distinct cafe venues
    expect(mockBookingGroupBy).toHaveBeenCalledWith({
      by: ["venueId"],
      where: {
        userId: testUserId,
        status: "CONFIRMED",
        venue: {
          category: "cafe",
        },
      },
    });

    // 4. Verify prisma.venue.count called for creator venues
    expect(mockVenueCount).toHaveBeenCalledWith({
      where: { creatorId: testUserId },
    });

    // 5. Verify unbounded prisma.booking.findMany was NOT invoked to count cafes
    expect(mockBookingFindMany).not.toHaveBeenCalled();

    // 6. Verify stats structure reflects database aggregates
    expect(json.gamification.stats).toEqual({
      reviewsCount: 20,
      venuesAddedCount: 2,
      speedtestsCount: 4,
      uniqueCafesBooked: 6,
      nightOwlReviewsCount: 1,
      accurateVotes: 12,
    });

    // 7. Verify XP calculation based on aggregate counts:
    // - 20 reviews * 50 = 1000
    // - 2 venues * 100 = 200
    // - 4 speedtests * 100 = 400
    // Total XP = 1600
    expect(json.gamification.xp).toBe(1600);
    expect(json.gamification.xpBreakdown).toEqual({
      reviewsXp: 1000,
      venuesXp: 200,
      speedtestsXp: 400,
    });

    // 8. Verify badges evaluated correctly from aggregates
    const badges = json.gamification.badges;
    const wifiBadge = badges.find((b: any) => b.id === "wifi_scout");
    expect(wifiBadge.earned).toBe(true);
    expect(wifiBadge.progress).toBe(3);

    const cafeBadge = badges.find((b: any) => b.id === "cafe_nomad");
    expect(cafeBadge.earned).toBe(true);
    expect(cafeBadge.progress).toBe(5);

    const nightBadge = badges.find((b: any) => b.id === "night_owl");
    expect(nightBadge.earned).toBe(true);
    expect(nightBadge.progress).toBe(1);

    const explorerBadge = badges.find((b: any) => b.id === "verified_explorer");
    expect(explorerBadge.earned).toBe(true);
    expect(explorerBadge.progress).toBe(10);
  });

  it("handles zero counts and empty groupings gracefully without division or calculation errors", async () => {
    mockRatingCount.mockResolvedValue(0);
    mockBookingGroupBy.mockResolvedValue([]);
    mockVenueCount.mockResolvedValue(0);
    mockRatingFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.gamification.stats).toEqual({
      reviewsCount: 0,
      venuesAddedCount: 0,
      speedtestsCount: 0,
      uniqueCafesBooked: 0,
      nightOwlReviewsCount: 0,
      accurateVotes: 12,
    });
    expect(json.gamification.xp).toBe(0);

    const cafeBadge = json.gamification.badges.find(
      (b: any) => b.id === "cafe_nomad",
    );
    expect(cafeBadge.earned).toBe(false);
    expect(cafeBadge.progress).toBe(0);
  });

  it("returns 401 when user is unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
