/**
 * Tests for loyalty points redemption for venue bookings.
 */

interface LoyaltyPointsAccount {
  accountId: string;
  userId: string;
  totalPoints: number;
  tier: "bronze" | "silver" | "gold" | "platinum";
  expiringPoints: number;    // points expiring within 30 days
  expiryDate: string | null;
}

interface RedemptionRule {
  tier: string;
  pointsPerCent: number;     // points needed per cent of discount
  minRedemption: number;     // min points to redeem
  maxDiscountPct: number;    // max discount % of booking total
}

const REDEMPTION_RULES: Record<string, RedemptionRule> = {
  bronze:   { tier: "bronze",   pointsPerCent: 10, minRedemption: 500,  maxDiscountPct: 10 },
  silver:   { tier: "silver",   pointsPerCent: 8,  minRedemption: 400,  maxDiscountPct: 15 },
  gold:     { tier: "gold",     pointsPerCent: 6,  minRedemption: 300,  maxDiscountPct: 20 },
  platinum: { tier: "platinum", pointsPerCent: 4,  minRedemption: 200,  maxDiscountPct: 30 },
};

function maxRedeemableDiscount(account: LoyaltyPointsAccount, bookingCents: number): number {
  const rule = REDEMPTION_RULES[account.tier];
  const discountFromPoints = Math.floor(account.totalPoints / rule.pointsPerCent);
  const maxByPct = Math.round(bookingCents * (rule.maxDiscountPct / 100));
  return Math.min(discountFromPoints, maxByPct);
}

function pointsRequired(discountCents: number, tier: string): number {
  const rule = REDEMPTION_RULES[tier];
  return discountCents * rule.pointsPerCent;
}

function canRedeem(account: LoyaltyPointsAccount, discountCents: number): boolean {
  const rule = REDEMPTION_RULES[account.tier];
  const required = pointsRequired(discountCents, account.tier);
  return account.totalPoints >= required && discountCents > 0 && required >= rule.minRedemption;
}

function redeemPoints(account: LoyaltyPointsAccount, discountCents: number): LoyaltyPointsAccount {
  if (!canRedeem(account, discountCents)) throw new Error("Cannot redeem points");
  const pointsUsed = pointsRequired(discountCents, account.tier);
  return { ...account, totalPoints: account.totalPoints - pointsUsed };
}

const ACCOUNT: LoyaltyPointsAccount = {
  accountId: "la1", userId: "u1", totalPoints: 2000, tier: "gold",
  expiringPoints: 200, expiryDate: "2026-12-31",
};

describe("Loyalty points redemption", () => {
  it("maxRedeemableDiscount: 2000 gold points at 6pts/cent = 333 cents, capped by 20%", () => {
    const max = maxRedeemableDiscount(ACCOUNT, 1000); // 1000 cents booking, 20% max = 200 cents
    expect(max).toBe(200);
  });

  it("pointsRequired: 100 cent discount × 6pts/cent = 600 gold", () => {
    expect(pointsRequired(100, "gold")).toBe(600);
  });

  it("canRedeem: 50 cents × 6 = 300 pts (meets min 300 for gold) → true", () => {
    expect(canRedeem(ACCOUNT, 50)).toBe(true);
  });

  it("canRedeem: 0 cents → false", () => {
    expect(canRedeem(ACCOUNT, 0)).toBe(false);
  });

  it("redeemPoints: deducts correct points", () => {
    const updated = redeemPoints(ACCOUNT, 50); // 50 × 6 = 300 pts
    expect(updated.totalPoints).toBe(1700);
  });

  it("redeemPoints: throws when insufficient", () => {
    const poor = { ...ACCOUNT, totalPoints: 100 };
    expect(() => redeemPoints(poor, 100)).toThrow("Cannot redeem");
  });
});
