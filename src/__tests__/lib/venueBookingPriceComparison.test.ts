/**
 * Tests for venue booking price comparison and market positioning.
 */

interface MarketPrice {
  venueId: string;
  category: string;
  city: string;
  pricePerHour: number;
  capacityGroup: "small" | "medium" | "large" | "xl";  // <50, 50-150, 150-500, 500+
  rating: number;
}

function capacityGroup(capacity: number): MarketPrice["capacityGroup"] {
  if (capacity < 50)  return "small";
  if (capacity < 150) return "medium";
  if (capacity < 500) return "large";
  return "xl";
}

function marketMedian(prices: MarketPrice[], category?: string, city?: string): number {
  let filtered = prices;
  if (category) filtered = filtered.filter((p) => p.category === category);
  if (city)     filtered = filtered.filter((p) => p.city === city);
  if (filtered.length === 0) return 0;
  const sorted = [...filtered].sort((a, b) => a.pricePerHour - b.pricePerHour);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1].pricePerHour + sorted[mid].pricePerHour) / 2)
    : sorted[mid].pricePerHour;
}

function pricePremiumPercent(price: number, median: number): number {
  if (median === 0) return 0;
  return Math.round(((price - median) / median) * 100);
}

function pricePositioning(price: number, prices: MarketPrice[]): "budget" | "value" | "standard" | "premium" | "luxury" {
  const median = marketMedian(prices);
  const premium = pricePremiumPercent(price, median);
  if (premium <= -30) return "budget";
  if (premium <= -10) return "value";
  if (premium <= 10)  return "standard";
  if (premium <= 40)  return "premium";
  return "luxury";
}

function similarVenues(
  venue: MarketPrice,
  allPrices: MarketPrice[],
  maxDiff = 30
): MarketPrice[] {
  return allPrices.filter(
    (p) => p.venueId !== venue.venueId &&
      p.category === venue.category &&
      p.capacityGroup === venue.capacityGroup &&
      Math.abs(p.pricePerHour - venue.pricePerHour) <= maxDiff
  );
}

const MARKET: MarketPrice[] = [
  { venueId: "v1", category: "conference", city: "London", pricePerHour: 150, capacityGroup: "medium", rating: 4.5 },
  { venueId: "v2", category: "conference", city: "London", pricePerHour: 200, capacityGroup: "medium", rating: 4.7 },
  { venueId: "v3", category: "conference", city: "London", pricePerHour: 120, capacityGroup: "medium", rating: 4.2 },
  { venueId: "v4", category: "conference", city: "London", pricePerHour: 250, capacityGroup: "medium", rating: 4.9 },
  { venueId: "v5", category: "workshop",   city: "London", pricePerHour: 80,  capacityGroup: "small",  rating: 4.0 },
];

describe("Price comparison and market positioning", () => {
  it("capacityGroup: 75 → medium", () => {
    expect(capacityGroup(75)).toBe("medium");
  });

  it("marketMedian: conference London = median of 120,150,200,250 = 175", () => {
    expect(marketMedian(MARKET, "conference", "London")).toBe(175);
  });

  it("pricePremiumPercent: $200 vs $175 median = +14%", () => {
    expect(pricePremiumPercent(200, 175)).toBe(14);
  });

  it("pricePositioning: $200 in market with $175 median → premium", () => {
    const confMarket = MARKET.filter((p) => p.category === "conference");
    expect(pricePositioning(200, confMarket)).toBe("premium");
  });

  it("similarVenues: v1 ($150) similar to v3 ($120, diff=30)", () => {
    const similar = similarVenues(MARKET[0], MARKET);
    expect(similar.map((p) => p.venueId)).toContain("v3");
  });
});
