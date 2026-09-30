/**
 * Tests for venue competitive market comparison metrics.
 */

interface MarketComparison {
  venueId: string;
  venuePrice: number;      // hourly rate in cents
  marketAvgPrice: number;
  marketMedianPrice: number;
  marketMinPrice: number;
  marketMaxPrice: number;
}

function pricePosition(comp: MarketComparison): "below_market" | "at_market" | "above_market" {
  const variance = (comp.venuePrice - comp.marketAvgPrice) / comp.marketAvgPrice;
  if (variance < -0.1) return "below_market";
  if (variance > 0.1) return "above_market";
  return "at_market";
}

function pricePercentile(comp: MarketComparison): number {
  const range = comp.marketMaxPrice - comp.marketMinPrice;
  if (range === 0) return 50;
  return Math.round(((comp.venuePrice - comp.marketMinPrice) / range) * 100);
}

function competitivePriceSuggestion(comp: MarketComparison): number {
  // Suggest market median as a competitive price
  return comp.marketMedianPrice;
}

function priceGap(comp: MarketComparison): number {
  return comp.venuePrice - comp.marketAvgPrice;
}

const COMP: MarketComparison = {
  venueId: "v1", venuePrice: 1200,
  marketAvgPrice: 1000, marketMedianPrice: 950,
  marketMinPrice: 500, marketMaxPrice: 2000,
};

describe("Venue market comparison", () => {
  it("pricePosition: 20% above market → above_market", () => {
    expect(pricePosition(COMP)).toBe("above_market");
  });

  it("pricePosition: at market average → at_market", () => {
    expect(pricePosition({ ...COMP, venuePrice: 1000 })).toBe("at_market");
  });

  it("pricePosition: 15% below → below_market", () => {
    expect(pricePosition({ ...COMP, venuePrice: 800 })).toBe("below_market");
  });

  it("pricePercentile: 1200 in 500-2000 range = 47%", () => {
    expect(pricePercentile(COMP)).toBe(47); // (1200-500)/(2000-500) = 700/1500 ≈ 47%
  });

  it("pricePercentile: at max = 100%", () => {
    expect(pricePercentile({ ...COMP, venuePrice: 2000 })).toBe(100);
  });

  it("pricePercentile: zero range → 50", () => {
    const flat = { ...COMP, marketMinPrice: 1000, marketMaxPrice: 1000, venuePrice: 1000 };
    expect(pricePercentile(flat)).toBe(50);
  });

  it("competitivePriceSuggestion: returns market median", () => {
    expect(competitivePriceSuggestion(COMP)).toBe(950);
  });

  it("priceGap: venue above market = +200", () => {
    expect(priceGap(COMP)).toBe(200);
  });

  it("priceGap: venue below market → negative", () => {
    expect(priceGap({ ...COMP, venuePrice: 800 })).toBe(-200);
  });
});
