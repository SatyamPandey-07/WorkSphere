/**
 * Tests for concierge upsell recommendations during booking flow.
 */

interface UpsellContext {
  bookingDurationHours: number;
  groupSize: number;
  venuePremiumLevel: "standard" | "premium" | "luxury";
  userTier: "basic" | "silver" | "gold";
  hasUsedConciergeBeforeAtVenue: boolean;
}

interface UpsellRecommendation {
  serviceId: string;
  name: string;
  priceCents: number;
  relevanceScore: number; // 0-100
  reason: string;
}

function calculateRelevance(
  service: { id: string; requiresLongBooking?: boolean; requiresGroup?: boolean; premiumOnly?: boolean },
  ctx: UpsellContext
): number {
  let score = 50;
  if (service.requiresLongBooking && ctx.bookingDurationHours >= 4) score += 25;
  if (service.requiresGroup && ctx.groupSize >= 3) score += 20;
  if (service.premiumOnly && ctx.venuePremiumLevel !== "standard") score += 15;
  if (ctx.userTier === "gold") score += 10;
  if (ctx.hasUsedConciergeBeforeAtVenue) score += 5;
  return Math.min(100, score);
}

function rankUpsells(
  services: { id: string; name: string; priceCents: number; requiresLongBooking?: boolean; requiresGroup?: boolean; premiumOnly?: boolean; reason: string }[],
  ctx: UpsellContext
): UpsellRecommendation[] {
  return services
    .map((s) => ({
      serviceId: s.id,
      name: s.name,
      priceCents: s.priceCents,
      relevanceScore: calculateRelevance(s, ctx),
      reason: s.reason,
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

const SERVICES = [
  { id: "s1", name: "Catered Lunch",      priceCents: 2500, requiresLongBooking: true,  requiresGroup: true,  premiumOnly: false, reason: "Perfect for 4h+ group sessions" },
  { id: "s2", name: "A/V Setup",          priceCents: 800,  requiresLongBooking: false, requiresGroup: false, premiumOnly: false, reason: "Enhance your presentation" },
  { id: "s3", name: "Personal Barista",   priceCents: 1500, requiresLongBooking: false, requiresGroup: false, premiumOnly: true,  reason: "Exclusive premium service" },
];

const CTX_LONG_GROUP: UpsellContext = {
  bookingDurationHours: 6, groupSize: 5, venuePremiumLevel: "premium",
  userTier: "gold", hasUsedConciergeBeforeAtVenue: true,
};

describe("Concierge upsell recommendations", () => {
  it("calculateRelevance: catered lunch for long group = very relevant", () => {
    const score = calculateRelevance(SERVICES[0], CTX_LONG_GROUP);
    expect(score).toBeGreaterThan(80);
  });

  it("calculateRelevance: base score 50 with no matching conditions", () => {
    const minCtx: UpsellContext = { bookingDurationHours: 1, groupSize: 1, venuePremiumLevel: "standard", userTier: "basic", hasUsedConciergeBeforeAtVenue: false };
    expect(calculateRelevance(SERVICES[1], minCtx)).toBe(50);
  });

  it("rankUpsells: highest relevance first", () => {
    const ranked = rankUpsells(SERVICES, CTX_LONG_GROUP);
    expect(ranked[0].relevanceScore).toBeGreaterThanOrEqual(ranked[1].relevanceScore);
  });

  it("rankUpsells: all services represented", () => {
    expect(rankUpsells(SERVICES, CTX_LONG_GROUP)).toHaveLength(3);
  });

  it("gold user gets +10 bonus on all services", () => {
    const goldCtx: UpsellContext = { ...CTX_LONG_GROUP, userTier: "gold" };
    const basicCtx: UpsellContext = { ...CTX_LONG_GROUP, userTier: "basic" };
    const goldScore = calculateRelevance(SERVICES[1], goldCtx);
    const basicScore = calculateRelevance(SERVICES[1], basicCtx);
    expect(goldScore - basicScore).toBe(10);
  });
});
