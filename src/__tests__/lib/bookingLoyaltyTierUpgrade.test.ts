/**
 * Tests for loyalty tier upgrade based on booking history.
 */

type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";

interface TierRequirement {
  tier: LoyaltyTier;
  minBookings: number;
  minSpendCents: number;
  minVenuesVisited: number;
}

const TIER_REQUIREMENTS: TierRequirement[] = [
  { tier: "bronze",   minBookings: 0,  minSpendCents: 0,       minVenuesVisited: 0  },
  { tier: "silver",   minBookings: 5,  minSpendCents: 50_000,  minVenuesVisited: 3  },
  { tier: "gold",     minBookings: 15, minSpendCents: 200_000, minVenuesVisited: 10 },
  { tier: "platinum", minBookings: 30, minSpendCents: 500_000, minVenuesVisited: 20 },
];

interface UserLoyaltyStats {
  totalBookings: number;
  totalSpentCents: number;
  uniqueVenuesVisited: number;
}

function qualifiesForTierLevel(stats: UserLoyaltyStats, req: TierRequirement): boolean {
  return (
    stats.totalBookings >= req.minBookings &&
    stats.totalSpentCents >= req.minSpendCents &&
    stats.uniqueVenuesVisited >= req.minVenuesVisited
  );
}

function calculateTier(stats: UserLoyaltyStats): LoyaltyTier {
  let highest: LoyaltyTier = "bronze";
  for (const req of TIER_REQUIREMENTS) {
    if (qualifiesForTierLevel(stats, req)) highest = req.tier;
  }
  return highest;
}

function upgradeProgress(
  stats: UserLoyaltyStats,
  currentTier: LoyaltyTier
): { nextTier: LoyaltyTier | null; percentComplete: number } {
  const tiers: LoyaltyTier[] = ["bronze", "silver", "gold", "platinum"];
  const idx = tiers.indexOf(currentTier);
  if (idx === tiers.length - 1) return { nextTier: null, percentComplete: 100 };

  const nextReq = TIER_REQUIREMENTS[idx + 1];
  const bookingPct = Math.min(100, (stats.totalBookings / nextReq.minBookings) * 100);
  const spendPct = Math.min(100, (stats.totalSpentCents / nextReq.minSpendCents) * 100);
  const venuePct = Math.min(100, (stats.uniqueVenuesVisited / nextReq.minVenuesVisited) * 100);
  return {
    nextTier: nextReq.tier,
    percentComplete: Math.round((bookingPct + spendPct + venuePct) / 3),
  };
}

describe("Booking loyalty tier upgrade", () => {
  it("calculateTier: 0 everything → bronze", () => {
    expect(calculateTier({ totalBookings: 0, totalSpentCents: 0, uniqueVenuesVisited: 0 })).toBe("bronze");
  });

  it("calculateTier: meets silver requirements → silver", () => {
    expect(calculateTier({ totalBookings: 5, totalSpentCents: 50_000, uniqueVenuesVisited: 3 })).toBe("silver");
  });

  it("calculateTier: exceeds gold → gold", () => {
    expect(calculateTier({ totalBookings: 20, totalSpentCents: 300_000, uniqueVenuesVisited: 12 })).toBe("gold");
  });

  it("calculateTier: meets platinum → platinum", () => {
    expect(calculateTier({ totalBookings: 30, totalSpentCents: 500_000, uniqueVenuesVisited: 20 })).toBe("platinum");
  });

  it("upgradeProgress: bronze showing next tier silver", () => {
    const { nextTier } = upgradeProgress({ totalBookings: 2, totalSpentCents: 10_000, uniqueVenuesVisited: 1 }, "bronze");
    expect(nextTier).toBe("silver");
  });

  it("upgradeProgress: platinum → null next tier", () => {
    const { nextTier, percentComplete } = upgradeProgress({ totalBookings: 30, totalSpentCents: 500_000, uniqueVenuesVisited: 20 }, "platinum");
    expect(nextTier).toBeNull();
    expect(percentComplete).toBe(100);
  });
});
