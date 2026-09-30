/**
 * Tests for venue booking loyalty points and rewards system.
 */

interface LoyaltyAccount {
  userId: string;
  points: number;
  tier: "bronze" | "silver" | "gold" | "platinum";
  lifetimePoints: number;
  lastActivityAt: number;
}

interface PointTransaction {
  userId: string;
  amount: number;
  type: "earn" | "redeem" | "expire" | "bonus";
  description: string;
  createdAt: number;
}

const TIER_THRESHOLDS = { bronze: 0, silver: 500, gold: 2000, platinum: 5000 };
const EARN_RATE = { bronze: 1, silver: 1.25, gold: 1.5, platinum: 2 };

function tierForPoints(lifetimePoints: number): LoyaltyAccount["tier"] {
  if (lifetimePoints >= TIER_THRESHOLDS.platinum) return "platinum";
  if (lifetimePoints >= TIER_THRESHOLDS.gold) return "gold";
  if (lifetimePoints >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

function pointsForBooking(basePoints: number, tier: LoyaltyAccount["tier"]): number {
  return Math.round(basePoints * EARN_RATE[tier]);
}

function redemptionValue(points: number, conversionRate = 0.01): number {
  return Math.round(points * conversionRate * 100) / 100;
}

function pointsToNextTier(account: LoyaltyAccount): number {
  const thresholds: LoyaltyAccount["tier"][] = ["bronze", "silver", "gold", "platinum"];
  const idx = thresholds.indexOf(account.tier);
  if (idx >= thresholds.length - 1) return 0; // already platinum
  const next = thresholds[idx + 1] as keyof typeof TIER_THRESHOLDS;
  return Math.max(0, TIER_THRESHOLDS[next] - account.lifetimePoints);
}

function balanceAfterRedeem(account: LoyaltyAccount, pointsToRedeem: number): number | null {
  if (pointsToRedeem > account.points) return null;
  return account.points - pointsToRedeem;
}

const ACCOUNT: LoyaltyAccount = {
  userId: "u1", points: 750, tier: "silver", lifetimePoints: 800, lastActivityAt: 1_700_000_000_000,
};

describe("Loyalty points system", () => {
  it("tierForPoints: 800 lifetime → silver", () => {
    expect(tierForPoints(800)).toBe("silver");
  });

  it("tierForPoints: 5000 → platinum", () => {
    expect(tierForPoints(5000)).toBe("platinum");
  });

  it("pointsForBooking: 100 base at silver (1.25x) = 125", () => {
    expect(pointsForBooking(100, "silver")).toBe(125);
  });

  it("redemptionValue: 750 points = $7.50", () => {
    expect(redemptionValue(750)).toBe(7.5);
  });

  it("pointsToNextTier: silver needs 1200 more to gold", () => {
    expect(pointsToNextTier(ACCOUNT)).toBe(1200);
  });

  it("balanceAfterRedeem: 750 - 200 = 550", () => {
    expect(balanceAfterRedeem(ACCOUNT, 200)).toBe(550);
  });

  it("balanceAfterRedeem: over balance → null", () => {
    expect(balanceAfterRedeem(ACCOUNT, 1000)).toBeNull();
  });
});
