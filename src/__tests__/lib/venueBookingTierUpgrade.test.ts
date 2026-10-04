/**
 * Tests for venue booking loyalty tier upgrade eligibility and transition.
 */

type LoyaltyTier = "standard" | "silver" | "gold" | "platinum" | "elite";

interface TierThreshold {
  tier: LoyaltyTier;
  minPoints: number;
  minBookings: number;
  minSpend: number;
  retentionRequired: boolean;
}

const THRESHOLDS: TierThreshold[] = [
  { tier: "standard", minPoints: 0,     minBookings: 0,  minSpend: 0,       retentionRequired: false },
  { tier: "silver",   minPoints: 500,   minBookings: 5,  minSpend: 2000,    retentionRequired: false },
  { tier: "gold",     minPoints: 1500,  minBookings: 15, minSpend: 8000,    retentionRequired: true },
  { tier: "platinum", minPoints: 5000,  minBookings: 40, minSpend: 25000,   retentionRequired: true },
  { tier: "elite",    minPoints: 15000, minBookings: 100,minSpend: 100000,  retentionRequired: true },
];

interface UserTierMetrics {
  points: number;
  totalBookings: number;
  totalSpend: number;
  consecutiveYears: number;
  currentTier: LoyaltyTier;
}

function meetsThreshold(user: UserTierMetrics, threshold: TierThreshold): boolean {
  if (user.points < threshold.minPoints) return false;
  if (user.totalBookings < threshold.minBookings) return false;
  if (user.totalSpend < threshold.minSpend) return false;
  if (threshold.retentionRequired && user.consecutiveYears < 1) return false;
  return true;
}

function eligibleTier(user: UserTierMetrics): LoyaltyTier {
  let highest: LoyaltyTier = "standard";
  for (const t of THRESHOLDS) {
    if (meetsThreshold(user, t)) highest = t.tier;
  }
  return highest;
}

function isUpgradeAvailable(user: UserTierMetrics): boolean {
  const eligible = eligibleTier(user);
  const tiers: LoyaltyTier[] = ["standard","silver","gold","platinum","elite"];
  return tiers.indexOf(eligible) > tiers.indexOf(user.currentTier);
}

function pointsToNextTierLevel(user: UserTierMetrics): number | null {
  const tiers: LoyaltyTier[] = ["standard","silver","gold","platinum","elite"];
  const currentIdx = tiers.indexOf(user.currentTier);
  if (currentIdx >= tiers.length - 1) return null;
  const next = THRESHOLDS.find((t) => t.tier === tiers[currentIdx + 1])!;
  return Math.max(0, next.minPoints - user.points);
}

const USER: UserTierMetrics = {
  points: 1800, totalBookings: 20, totalSpend: 9000,
  consecutiveYears: 2, currentTier: "silver",
};

describe("Loyalty tier upgrade eligibility", () => {
  it("eligibleTier: 1800pts, 20 bookings, $9k → gold", () => {
    expect(eligibleTier(USER)).toBe("gold");
  });

  it("isUpgradeAvailable: silver user eligible for gold → true", () => {
    expect(isUpgradeAvailable(USER)).toBe(true);
  });

  it("isUpgradeAvailable: already at highest eligible tier → false", () => {
    const atTop = { ...USER, currentTier: "gold" as LoyaltyTier };
    expect(isUpgradeAvailable(atTop)).toBe(false);
  });

  it("pointsToNextTierLevel: silver → gold needs 1500, has 1800 → 0", () => {
    const silverUser = { ...USER, currentTier: "silver" as LoyaltyTier };
    expect(pointsToNextTierLevel(silverUser)).toBe(0);
  });

  it("meetsThreshold: user meets gold threshold", () => {
    const goldThreshold = THRESHOLDS.find((t) => t.tier === "gold")!;
    expect(meetsThreshold(USER, goldThreshold)).toBe(true);
  });

  it("pointsToNextTierLevel: elite tier → null (highest)", () => {
    const elite = { ...USER, currentTier: "elite" as LoyaltyTier };
    expect(pointsToNextTierLevel(elite)).toBeNull();
  });
});
