/**
 * Tests for venue booking marketplace mechanics.
 */

interface MarketplaceListing {
  listingId: string;
  venueId: string;
  title: string;
  hourlyRateCents: number;
  minHours: number;
  maxHours: number;
  availableSlots: number;
  featuredUntil: number | null;
  boostScore: number;   // 0-100, promotional boost
  organicScore: number; // 0-100, natural search rank
}

function effectiveRank(listing: MarketplaceListing, nowMs: number): number {
  const isFeatured = listing.featuredUntil !== null && nowMs < listing.featuredUntil;
  const featuredBonus = isFeatured ? 50 : 0;
  return listing.organicScore + listing.boostScore + featuredBonus;
}

function sortedMarketplace(
  listings: MarketplaceListing[],
  nowMs: number
): MarketplaceListing[] {
  return [...listings].sort((a, b) => effectiveRank(b, nowMs) - effectiveRank(a, nowMs));
}

function availableListings(
  listings: MarketplaceListing[],
  requiredHours: number
): MarketplaceListing[] {
  return listings.filter(
    (l) => l.availableSlots > 0 && requiredHours >= l.minHours && requiredHours <= l.maxHours
  );
}

function marketplacePriceStats(listings: MarketplaceListing[]): {
  min: number; max: number; avg: number; median: number;
} {
  if (listings.length === 0) return { min: 0, max: 0, avg: 0, median: 0 };
  const prices = [...listings].sort((a, b) => a.hourlyRateCents - b.hourlyRateCents);
  const min = prices[0].hourlyRateCents;
  const max = prices[prices.length - 1].hourlyRateCents;
  const avg = Math.round(prices.reduce((s, p) => s + p.hourlyRateCents, 0) / prices.length);
  const median = prices[Math.floor(prices.length / 2)].hourlyRateCents;
  return { min, max, avg, median };
}

const NOW = 1_700_000_000_000;
const LISTINGS: MarketplaceListing[] = [
  { listingId: "l1", venueId: "v1", title: "Budget Hub",    hourlyRateCents: 500,  minHours: 1, maxHours: 8,  availableSlots: 5,  featuredUntil: null,        boostScore: 0,  organicScore: 70 },
  { listingId: "l2", venueId: "v2", title: "Premium Space", hourlyRateCents: 2000, minHours: 2, maxHours: 12, availableSlots: 2,  featuredUntil: NOW + 86400_000, boostScore: 20, organicScore: 60 },
  { listingId: "l3", venueId: "v3", title: "Quick Desk",    hourlyRateCents: 800,  minHours: 1, maxHours: 4,  availableSlots: 0,  featuredUntil: null,        boostScore: 5,  organicScore: 75 },
];

describe("Venue booking marketplace", () => {
  it("effectiveRank: featured listing gets +50 bonus", () => {
    const rank2 = effectiveRank(LISTINGS[1], NOW);
    const rank1 = effectiveRank(LISTINGS[0], NOW);
    expect(rank2).toBeGreaterThan(rank1); // 60+20+50=130 vs 70+0=70
  });

  it("sortedMarketplace: featured first", () => {
    const sorted = sortedMarketplace(LISTINGS, NOW);
    expect(sorted[0].listingId).toBe("l2");
  });

  it("availableListings: 3h booking → l1 and l2 (l3 no slots, l2 min 2h OK)", () => {
    const available = availableListings(LISTINGS, 3);
    expect(available.map((l) => l.listingId)).toContain("l1");
    expect(available.map((l) => l.listingId)).toContain("l2");
    expect(available.map((l) => l.listingId)).not.toContain("l3"); // no slots
  });

  it("availableListings: 1h → l1 only (l2 min 2h)", () => {
    const available = availableListings(LISTINGS, 1);
    expect(available.map((l) => l.listingId)).toContain("l1");
    expect(available.map((l) => l.listingId)).not.toContain("l2");
  });

  it("marketplacePriceStats: min 500, max 2000", () => {
    const stats = marketplacePriceStats(LISTINGS);
    expect(stats.min).toBe(500);
    expect(stats.max).toBe(2000);
  });
});
