/**
 * Tests for venue booking subscription tier management.
 */

type Tier = "free" | "starter" | "professional" | "enterprise";

interface TierConfig {
  name: Tier;
  monthlyPrice: number;
  maxBookingsPerMonth: number;
  maxVenues: number;
  analyticsEnabled: boolean;
  supportLevel: "community" | "email" | "priority" | "dedicated";
  discountPercent: number;
}

const TIERS: Record<Tier, TierConfig> = {
  free:         { name: "free",         monthlyPrice: 0,   maxBookingsPerMonth: 5,   maxVenues: 1,  analyticsEnabled: false, supportLevel: "community", discountPercent: 0 },
  starter:      { name: "starter",      monthlyPrice: 29,  maxBookingsPerMonth: 30,  maxVenues: 3,  analyticsEnabled: false, supportLevel: "email",     discountPercent: 5 },
  professional: { name: "professional", monthlyPrice: 99,  maxBookingsPerMonth: 100, maxVenues: 10, analyticsEnabled: true,  supportLevel: "priority",  discountPercent: 10 },
  enterprise:   { name: "enterprise",   monthlyPrice: 299, maxBookingsPerMonth: Infinity, maxVenues: Infinity, analyticsEnabled: true, supportLevel: "dedicated", discountPercent: 20 },
};

function canBook(tier: Tier, currentMonthBookings: number): boolean {
  return currentMonthBookings < TIERS[tier].maxBookingsPerMonth;
}

function discountedPrice(basePrice: number, tier: Tier): number {
  const cfg = TIERS[tier];
  return Math.round(basePrice * (1 - cfg.discountPercent / 100) * 100) / 100;
}

function annualSavings(tier: Tier): number {
  if (tier === "free") return 0;
  const monthly = TIERS[tier].monthlyPrice;
  return Math.round(monthly * 12 * 0.15 * 100) / 100; // ~15% annual discount
}

function recommendTier(monthlyBookings: number, venueCount: number): Tier {
  if (monthlyBookings <= 5 && venueCount <= 1) return "free";
  if (monthlyBookings <= 30 && venueCount <= 3) return "starter";
  if (monthlyBookings <= 100 && venueCount <= 10) return "professional";
  return "enterprise";
}

function upgradeRequired(tier: Tier, currentBookings: number, neededBookings: number): boolean {
  const cfg = TIERS[tier];
  return currentBookings + neededBookings > cfg.maxBookingsPerMonth;
}

describe("Subscription tier management", () => {
  it("canBook: free with 4 bookings can book", () => {
    expect(canBook("free", 4)).toBe(true);
  });

  it("canBook: free at limit cannot book", () => {
    expect(canBook("free", 5)).toBe(false);
  });

  it("discountedPrice: 10% discount for professional", () => {
    expect(discountedPrice(100, "professional")).toBe(90);
  });

  it("annualSavings: free → 0", () => {
    expect(annualSavings("free")).toBe(0);
  });

  it("recommendTier: high bookings → enterprise", () => {
    expect(recommendTier(200, 20)).toBe("enterprise");
  });

  it("recommendTier: low usage → free", () => {
    expect(recommendTier(3, 1)).toBe("free");
  });

  it("upgradeRequired: when needed exceeds limit", () => {
    expect(upgradeRequired("starter", 28, 5)).toBe(true);
  });
});
