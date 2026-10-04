/**
 * Tests for venue dynamic pricing model v2 with competitor analysis.
 */

interface CompetitorPrice {
  competitorId: string;
  venueType: string;
  pricePerHour: number;
  capacity: number;
  rating: number;
}

interface PricingContext {
  venueId: string;
  basePrice: number;
  capacity: number;
  rating: number;
  currentOccupancy: number;
  competitors: CompetitorPrice[];
}

function marketAvgPrice(competitors: CompetitorPrice[]): number {
  if (competitors.length === 0) return 0;
  return Math.round(competitors.reduce((s, c) => s + c.pricePerHour, 0) / competitors.length * 100) / 100;
}

function percentileRank(price: number, competitors: CompetitorPrice[]): number {
  if (competitors.length === 0) return 50;
  const lower = competitors.filter((c) => c.pricePerHour < price).length;
  return Math.round((lower / competitors.length) * 100);
}

function competitivePriceRecommendation(ctx: PricingContext): number {
  const avg = marketAvgPrice(ctx.competitors);
  if (avg === 0) return ctx.basePrice;
  // Premium venues (higher rating) can command higher prices
  const ratingPremium = (ctx.rating / 5) * 0.2;
  // Adjust for occupancy
  const occupancyAdjust = ctx.currentOccupancy > 0.8 ? 1.1 : ctx.currentOccupancy < 0.4 ? 0.9 : 1.0;
  const recommended = avg * (1 + ratingPremium) * occupancyAdjust;
  return Math.round(recommended * 100) / 100;
}

function isPriceCompetitive(ctx: PricingContext): boolean {
  const rank = percentileRank(ctx.basePrice, ctx.competitors);
  return rank >= 20 && rank <= 80; // within middle 60%
}

function priceGapToLeader(ctx: PricingContext): number {
  if (ctx.competitors.length === 0) return 0;
  const maxCompPrice = Math.max(...ctx.competitors.map((c) => c.pricePerHour));
  return Math.round((maxCompPrice - ctx.basePrice) * 100) / 100;
}

const COMPETITORS: CompetitorPrice[] = [
  { competitorId: "c1", venueType: "ballroom", pricePerHour: 180, capacity: 300, rating: 4.2 },
  { competitorId: "c2", venueType: "ballroom", pricePerHour: 220, capacity: 400, rating: 4.7 },
  { competitorId: "c3", venueType: "ballroom", pricePerHour: 160, capacity: 250, rating: 3.9 },
  { competitorId: "c4", venueType: "ballroom", pricePerHour: 250, capacity: 500, rating: 4.9 },
];
const CTX: PricingContext = {
  venueId: "v1", basePrice: 200, capacity: 350, rating: 4.5,
  currentOccupancy: 0.75, competitors: COMPETITORS,
};

describe("Dynamic pricing v2 with competitor analysis", () => {
  it("marketAvgPrice: (180+220+160+250)/4 = 202.5", () => {
    expect(marketAvgPrice(COMPETITORS)).toBe(202.5);
  });

  it("percentileRank: $200 is above c1,c3 = 50th percentile", () => {
    expect(percentileRank(200, COMPETITORS)).toBe(50);
  });

  it("competitivePriceRecommendation: returns positive number", () => {
    expect(competitivePriceRecommendation(CTX)).toBeGreaterThan(0);
  });

  it("isPriceCompetitive: $200 at 50th percentile → true", () => {
    expect(isPriceCompetitive(CTX)).toBe(true);
  });

  it("priceGapToLeader: $250 - $200 = $50", () => {
    expect(priceGapToLeader(CTX)).toBe(50);
  });

  it("competitivePriceRecommendation: high occupancy boosts price", () => {
    const highOcc = { ...CTX, currentOccupancy: 0.9 };
    const lowOcc  = { ...CTX, currentOccupancy: 0.3 };
    expect(competitivePriceRecommendation(highOcc)).toBeGreaterThan(competitivePriceRecommendation(lowOcc));
  });
});
