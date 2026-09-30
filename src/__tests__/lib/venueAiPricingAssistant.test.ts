/**
 * Tests for AI pricing assistant recommendations.
 */

interface PricingContext {
  venueId: string;
  currentPriceCents: number;
  marketAvgCents: number;
  occupancyTrend: "improving" | "stable" | "declining";
  competitorCount: number;
  seasonality: "peak" | "normal" | "off-peak";
  recentReviewScore: number;  // 1-5
}

interface PricingRecommendation {
  recommendedPriceCents: number;
  changePercent: number;
  confidence: "low" | "medium" | "high";
  reasoning: string[];
}

function generatePricingRecommendation(ctx: PricingContext): PricingRecommendation {
  let adjustmentPct = 0;
  const reasoning: string[] = [];

  // Market position
  const marketGap = ((ctx.currentPriceCents - ctx.marketAvgCents) / ctx.marketAvgCents) * 100;
  if (marketGap > 20) { adjustmentPct -= 5; reasoning.push("Priced above market - consider reduction"); }
  else if (marketGap < -20) { adjustmentPct += 5; reasoning.push("Priced below market - room for increase"); }

  // Seasonality
  if (ctx.seasonality === "peak") { adjustmentPct += 10; reasoning.push("Peak season demand"); }
  else if (ctx.seasonality === "off-peak") { adjustmentPct -= 8; reasoning.push("Off-peak: attract more bookings"); }

  // Occupancy trend
  if (ctx.occupancyTrend === "improving") { adjustmentPct += 5; reasoning.push("Growing demand supports increase"); }
  else if (ctx.occupancyTrend === "declining") { adjustmentPct -= 5; reasoning.push("Declining demand: consider price reduction"); }

  // Review score bonus
  if (ctx.recentReviewScore >= 4.5) { adjustmentPct += 3; reasoning.push("High review score supports premium pricing"); }

  const recommended = Math.round(ctx.currentPriceCents * (1 + adjustmentPct / 100));
  const confidence = Math.abs(adjustmentPct) < 5 ? "low" : Math.abs(adjustmentPct) < 15 ? "medium" : "high";

  return { recommendedPriceCents: recommended, changePercent: adjustmentPct, confidence, reasoning };
}

describe("AI pricing assistant", () => {
  const BASE_CTX: PricingContext = {
    venueId: "v1", currentPriceCents: 1000, marketAvgCents: 1000,
    occupancyTrend: "stable", competitorCount: 5,
    seasonality: "normal", recentReviewScore: 4.0,
  };

  it("peak season → price increase", () => {
    const ctx = { ...BASE_CTX, seasonality: "peak" as const };
    const rec = generatePricingRecommendation(ctx);
    expect(rec.recommendedPriceCents).toBeGreaterThan(BASE_CTX.currentPriceCents);
  });

  it("off-peak season → price decrease", () => {
    const ctx = { ...BASE_CTX, seasonality: "off-peak" as const };
    const rec = generatePricingRecommendation(ctx);
    expect(rec.recommendedPriceCents).toBeLessThan(BASE_CTX.currentPriceCents);
  });

  it("above market → decrease recommendation", () => {
    const ctx = { ...BASE_CTX, currentPriceCents: 1300 }; // 30% above market
    const rec = generatePricingRecommendation(ctx);
    expect(rec.changePercent).toBeLessThan(0);
  });

  it("high review score → bonus", () => {
    const highRating = { ...BASE_CTX, recentReviewScore: 4.8 };
    const normal = generatePricingRecommendation(BASE_CTX);
    const high = generatePricingRecommendation(highRating);
    expect(high.recommendedPriceCents).toBeGreaterThan(normal.recommendedPriceCents);
  });

  it("reasoning is non-empty when adjustments made", () => {
    const ctx = { ...BASE_CTX, seasonality: "peak" as const };
    expect(generatePricingRecommendation(ctx).reasoning.length).toBeGreaterThan(0);
  });

  it("stable neutral context → confidence low", () => {
    const rec = generatePricingRecommendation(BASE_CTX);
    expect(rec.confidence).toBe("low");
  });
});
