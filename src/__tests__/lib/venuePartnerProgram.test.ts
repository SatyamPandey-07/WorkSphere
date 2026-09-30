/**
 * Tests for venue partner program tier and commission management.
 */

type PartnerTier = "standard" | "preferred" | "elite";

interface PartnerConfig {
  venueId: string;
  tier: PartnerTier;
  commissionPct: number;
  monthlyRevenueThreshold: number;
  bonusBookingPct: number;
}

const TIER_CONFIGS: Record<PartnerTier, PartnerConfig> = {
  standard:  { venueId: "", tier: "standard",  commissionPct: 15, monthlyRevenueThreshold: 0,       bonusBookingPct: 0  },
  preferred: { venueId: "", tier: "preferred", commissionPct: 12, monthlyRevenueThreshold: 100_000, bonusBookingPct: 5  },
  elite:     { venueId: "", tier: "elite",     commissionPct: 8,  monthlyRevenueThreshold: 500_000, bonusBookingPct: 10 },
};

function commissionAmount(revenueCents: number, tier: PartnerTier): number {
  return Math.round(revenueCents * (TIER_CONFIGS[tier].commissionPct / 100));
}

function qualifiesForTier(monthlyRevenueCents: number, tier: PartnerTier): boolean {
  return monthlyRevenueCents >= TIER_CONFIGS[tier].monthlyRevenueThreshold;
}

function recommendedTier(monthlyRevenueCents: number): PartnerTier {
  if (qualifiesForTier(monthlyRevenueCents, "elite"))     return "elite";
  if (qualifiesForTier(monthlyRevenueCents, "preferred")) return "preferred";
  return "standard";
}

function userDiscountFromPartner(bookingCents: number, tier: PartnerTier): number {
  return Math.round(bookingCents * (TIER_CONFIGS[tier].bonusBookingPct / 100));
}

describe("Venue partner program", () => {
  it("commissionAmount: standard 15% of 10000 = 1500", () => {
    expect(commissionAmount(10_000, "standard")).toBe(1500);
  });

  it("commissionAmount: elite 8% of 10000 = 800", () => {
    expect(commissionAmount(10_000, "elite")).toBe(800);
  });

  it("qualifiesForTier: 0 qualifies for standard", () => {
    expect(qualifiesForTier(0, "standard")).toBe(true);
  });

  it("qualifiesForTier: 100000 qualifies for preferred", () => {
    expect(qualifiesForTier(100_000, "preferred")).toBe(true);
  });

  it("qualifiesForTier: 99999 does not qualify for preferred", () => {
    expect(qualifiesForTier(99_999, "preferred")).toBe(false);
  });

  it("recommendedTier: high revenue → elite", () => {
    expect(recommendedTier(600_000)).toBe("elite");
  });

  it("recommendedTier: mid revenue → preferred", () => {
    expect(recommendedTier(200_000)).toBe("preferred");
  });

  it("recommendedTier: low revenue → standard", () => {
    expect(recommendedTier(50_000)).toBe("standard");
  });

  it("userDiscountFromPartner: elite 10% of 5000 = 500", () => {
    expect(userDiscountFromPartner(5000, "elite")).toBe(500);
  });

  it("userDiscountFromPartner: standard = 0", () => {
    expect(userDiscountFromPartner(5000, "standard")).toBe(0);
  });
});
