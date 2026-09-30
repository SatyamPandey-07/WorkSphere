/**
 * Tests for venue booking customer segmentation.
 */

type CustomerSegment = "budget_hunter" | "convenience_seeker" | "quality_focused" | "loyalty_member" | "business_traveler";

interface BookingBehavior {
  userId: string;
  avgBookingCents: number;
  advanceBookingDays: number;
  repeatBookingPct: number;  // 0-1
  premiumFeatureUsage: number; // 0-1
  priceChangeResponse: number; // -1 to 1 (-1 very sensitive to price)
}

function classifySegment(behavior: BookingBehavior): CustomerSegment {
  if (behavior.repeatBookingPct > 0.7 && behavior.premiumFeatureUsage > 0.5) return "loyalty_member";
  if (behavior.avgBookingCents > 15_000) return "business_traveler";
  if (behavior.priceChangeResponse < -0.5) return "budget_hunter";
  if (behavior.premiumFeatureUsage > 0.6) return "quality_focused";
  if (behavior.advanceBookingDays <= 1) return "convenience_seeker";
  return "convenience_seeker";
}

function segmentPersonalization(segment: CustomerSegment): {
  showPriceComparison: boolean;
  highlightPremium: boolean;
  sendReminders: boolean;
  offerLoyaltyBonus: boolean;
} {
  return {
    showPriceComparison: segment === "budget_hunter",
    highlightPremium:    segment === "quality_focused" || segment === "business_traveler",
    sendReminders:       segment === "convenience_seeker",
    offerLoyaltyBonus:   segment === "loyalty_member",
  };
}

function segmentAverageRevenue(
  behaviors: BookingBehavior[],
  segment: CustomerSegment
): number {
  const segmentUsers = behaviors.filter((b) => classifySegment(b) === segment);
  if (segmentUsers.length === 0) return 0;
  return Math.round(segmentUsers.reduce((s, b) => s + b.avgBookingCents, 0) / segmentUsers.length);
}

const BEHAVIORS: BookingBehavior[] = [
  { userId: "u1", avgBookingCents: 2000, advanceBookingDays: 0,  repeatBookingPct: 0.3, premiumFeatureUsage: 0.1, priceChangeResponse: -0.8 },
  { userId: "u2", avgBookingCents: 5000, advanceBookingDays: 7,  repeatBookingPct: 0.8, premiumFeatureUsage: 0.7, priceChangeResponse: -0.1 },
  { userId: "u3", avgBookingCents: 20000,advanceBookingDays: 14, repeatBookingPct: 0.4, premiumFeatureUsage: 0.8, priceChangeResponse: 0.2 },
];

describe("Venue booking customer segmentation", () => {
  it("classifySegment: u1 (price sensitive) → budget_hunter", () => {
    expect(classifySegment(BEHAVIORS[0])).toBe("budget_hunter");
  });

  it("classifySegment: u2 (loyal + premium) → loyalty_member", () => {
    expect(classifySegment(BEHAVIORS[1])).toBe("loyalty_member");
  });

  it("classifySegment: u3 (high spend) → business_traveler", () => {
    expect(classifySegment(BEHAVIORS[2])).toBe("business_traveler");
  });

  it("segmentPersonalization: budget_hunter → show price comparison", () => {
    const perso = segmentPersonalization("budget_hunter");
    expect(perso.showPriceComparison).toBe(true);
    expect(perso.offerLoyaltyBonus).toBe(false);
  });

  it("segmentPersonalization: loyalty_member → loyalty bonus", () => {
    expect(segmentPersonalization("loyalty_member").offerLoyaltyBonus).toBe(true);
  });

  it("segmentAverageRevenue: business_traveler = 20000", () => {
    expect(segmentAverageRevenue(BEHAVIORS, "business_traveler")).toBe(20000);
  });

  it("segmentAverageRevenue: unknown segment → 0", () => {
    expect(segmentAverageRevenue(BEHAVIORS, "convenience_seeker")).toBe(0);
  });
});
