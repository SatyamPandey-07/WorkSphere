/**
 * Tests for venue booking badge and gamification system.
 */

type BadgeTier = "bronze" | "silver" | "gold" | "platinum";

interface Badge {
  id: string;
  name: string;
  description: string;
  tier: BadgeTier;
  pointsValue: number;
  criteria: { field: string; threshold: number };
}

interface UserProgress {
  userId: string;
  totalBookings: number;
  totalSpend: number;
  reviewsGiven: number;
  venuesVisited: Set<string>;
  earnedBadgeIds: string[];
}

const BADGES: Badge[] = [
  { id: "b1", name: "First Booking",    description: "Complete your first booking", tier: "bronze",   pointsValue: 50,  criteria: { field: "totalBookings",  threshold: 1 } },
  { id: "b2", name: "Regular",          description: "10 bookings completed",       tier: "silver",   pointsValue: 200, criteria: { field: "totalBookings",  threshold: 10 } },
  { id: "b3", name: "Explorer",         description: "Visit 5 different venues",    tier: "silver",   pointsValue: 150, criteria: { field: "venuesVisited",  threshold: 5 } },
  { id: "b4", name: "Big Spender",      description: "Spend $5000 total",           tier: "gold",     pointsValue: 500, criteria: { field: "totalSpend",     threshold: 5000 } },
  { id: "b5", name: "Review Champion",  description: "Leave 20 reviews",            tier: "gold",     pointsValue: 400, criteria: { field: "reviewsGiven",   threshold: 20 } },
];

function getProgressValue(progress: UserProgress, field: string): number {
  if (field === "venuesVisited") return progress.venuesVisited.size;
  return (progress as unknown as Record<string, number>)[field] ?? 0;
}

function eligibleBadges(progress: UserProgress): Badge[] {
  return BADGES.filter((b) => {
    if (progress.earnedBadgeIds.includes(b.id)) return false;
    return getProgressValue(progress, b.criteria.field) >= b.criteria.threshold;
  });
}

function totalPoints(progress: UserProgress): number {
  return BADGES
    .filter((b) => progress.earnedBadgeIds.includes(b.id))
    .reduce((s, b) => s + b.pointsValue, 0);
}

function badgeProgress(badge: Badge, progress: UserProgress): number {
  const current = getProgressValue(progress, badge.criteria.field);
  return Math.min(Math.round((current / badge.criteria.threshold) * 100), 100);
}

function highestTierEarned(progress: UserProgress): BadgeTier | null {
  const tierOrder: BadgeTier[] = ["bronze", "silver", "gold", "platinum"];
  const earnedTiers = BADGES
    .filter((b) => progress.earnedBadgeIds.includes(b.id))
    .map((b) => b.tier);
  if (earnedTiers.length === 0) return null;
  return tierOrder.reduce((max, t) => earnedTiers.includes(t) ? t : max, "bronze" as BadgeTier);
}

const PROGRESS: UserProgress = {
  userId: "u1", totalBookings: 3, totalSpend: 750, reviewsGiven: 2,
  venuesVisited: new Set(["v1", "v2", "v3"]),
  earnedBadgeIds: ["b1"],
};

describe("Badge gamification system", () => {
  it("eligibleBadges: no new eligible badges for low progress", () => {
    const eligible = eligibleBadges(PROGRESS);
    expect(eligible.every((b) => b.id !== "b1")).toBe(true); // already earned
  });

  it("totalPoints: b1 = 50 points", () => {
    expect(totalPoints(PROGRESS)).toBe(50);
  });

  it("badgeProgress: b2 requires 10 bookings, at 3 = 30%", () => {
    expect(badgeProgress(BADGES[1], PROGRESS)).toBe(30);
  });

  it("badgeProgress: b1 completed = 100%", () => {
    expect(badgeProgress(BADGES[0], PROGRESS)).toBe(100);
  });

  it("highestTierEarned: b1 is bronze", () => {
    expect(highestTierEarned(PROGRESS)).toBe("bronze");
  });

  it("highestTierEarned: no badges → null", () => {
    expect(highestTierEarned({ ...PROGRESS, earnedBadgeIds: [] })).toBeNull();
  });
});
