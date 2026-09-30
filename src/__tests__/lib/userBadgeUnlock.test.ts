/**
 * Tests for user achievement badge unlock conditions.
 */

interface UserStats {
  totalBookings: number;
  uniqueVenues: number;
  reviewsWritten: number;
  consecutiveDays: number;
  referrals: number;
}

interface Badge {
  id: string;
  name: string;
  condition: (stats: UserStats) => boolean;
}

const BADGES: Badge[] = [
  { id: "first-booking",    name: "First Booking",    condition: (s) => s.totalBookings >= 1    },
  { id: "explorer",         name: "Explorer",         condition: (s) => s.uniqueVenues >= 10    },
  { id: "reviewer",         name: "Reviewer",         condition: (s) => s.reviewsWritten >= 5   },
  { id: "streak-7",         name: "Week Warrior",     condition: (s) => s.consecutiveDays >= 7  },
  { id: "ambassador",       name: "Ambassador",       condition: (s) => s.referrals >= 3        },
];

function unlockedBadges(stats: UserStats): Badge[] {
  return BADGES.filter((b) => b.condition(stats));
}

function hasBadge(stats: UserStats, badgeId: string): boolean {
  return BADGES.find((b) => b.id === badgeId)?.condition(stats) ?? false;
}

const ZERO_STATS: UserStats = { totalBookings: 0, uniqueVenues: 0, reviewsWritten: 0, consecutiveDays: 0, referrals: 0 };

describe("User badge unlock conditions", () => {
  it("no badges for zero stats", () => {
    expect(unlockedBadges(ZERO_STATS)).toHaveLength(0);
  });

  it("first-booking badge unlocked at 1 booking", () => {
    expect(hasBadge({ ...ZERO_STATS, totalBookings: 1 }, "first-booking")).toBe(true);
  });

  it("explorer badge requires 10 unique venues", () => {
    expect(hasBadge({ ...ZERO_STATS, uniqueVenues: 9 }, "explorer")).toBe(false);
    expect(hasBadge({ ...ZERO_STATS, uniqueVenues: 10 }, "explorer")).toBe(true);
  });

  it("reviewer badge requires 5 reviews", () => {
    expect(hasBadge({ ...ZERO_STATS, reviewsWritten: 5 }, "reviewer")).toBe(true);
  });

  it("streak badge requires 7 consecutive days", () => {
    expect(hasBadge({ ...ZERO_STATS, consecutiveDays: 7 }, "streak-7")).toBe(true);
    expect(hasBadge({ ...ZERO_STATS, consecutiveDays: 6 }, "streak-7")).toBe(false);
  });

  it("ambassador badge requires 3 referrals", () => {
    expect(hasBadge({ ...ZERO_STATS, referrals: 3 }, "ambassador")).toBe(true);
  });

  it("all badges unlocked for high stats", () => {
    const maxStats: UserStats = { totalBookings: 100, uniqueVenues: 20, reviewsWritten: 10, consecutiveDays: 30, referrals: 5 };
    expect(unlockedBadges(maxStats)).toHaveLength(5);
  });

  it("unknown badge id returns false", () => {
    expect(hasBadge(ZERO_STATS, "nonexistent")).toBe(false);
  });
});
