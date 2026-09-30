/**
 * Tests for venue search result ranking algorithm.
 */

interface SearchVenue {
  venueId: string;
  name: string;
  distanceKm: number;
  rating: number;
  reviewCount: number;
  priceCategory: number; // 1=budget, 2=mid, 3=premium
  isSponsored: boolean;
  hasInstantBook: boolean;
}

interface SearchWeights {
  distance: number;
  rating: number;
  reviewCount: number;
  price: number;
  instantBook: number;
}

const DEFAULT_WEIGHTS: SearchWeights = {
  distance: -2,
  rating: 15,
  reviewCount: 0.05,
  price: -3,
  instantBook: 5,
};

function rankingScore(venue: SearchVenue, weights = DEFAULT_WEIGHTS): number {
  let score = 0;
  score += venue.distanceKm * weights.distance;
  score += venue.rating * weights.rating;
  score += venue.reviewCount * weights.reviewCount;
  score += venue.priceCategory * weights.price;
  if (venue.hasInstantBook) score += weights.instantBook;
  if (venue.isSponsored) score += 20; // fixed boost
  return Math.round(score * 10) / 10;
}

function rankSearchResults(
  venues: SearchVenue[],
  weights?: SearchWeights
): SearchVenue[] {
  return [...venues].sort(
    (a, b) => rankingScore(b, weights) - rankingScore(a, weights)
  );
}

const VENUES: SearchVenue[] = [
  { venueId: "v1", name: "Budget Hub",   distanceKm: 1, rating: 4.5, reviewCount: 50, priceCategory: 1, isSponsored: false, hasInstantBook: true  }, // 4.5*15-1*2-1*3+5+50*0.05=69
  { venueId: "v2", name: "Near Premium", distanceKm: 0.5, rating: 4.0, reviewCount: 100, priceCategory: 3, isSponsored: false, hasInstantBook: false }, // 4*15-0.5*2-3*3+100*0.05=53
  { venueId: "v3", name: "Sponsored",    distanceKm: 5, rating: 3.0, reviewCount: 10, priceCategory: 1, isSponsored: true,  hasInstantBook: false }, // sponsored boost
];

describe("Venue search ranking", () => {
  it("rankingScore: instant book adds bonus", () => {
    const withoutInstant = { ...VENUES[0], hasInstantBook: false };
    expect(rankingScore(VENUES[0])).toBeGreaterThan(rankingScore(withoutInstant));
  });

  it("rankingScore: sponsored adds 20 pts", () => {
    const noSponsor = { ...VENUES[2], isSponsored: false };
    expect(rankingScore(VENUES[2]) - rankingScore(noSponsor)).toBeCloseTo(20);
  });

  it("rankingScore: higher rating → higher score", () => {
    const low = { ...VENUES[0], rating: 3.0 };
    expect(rankingScore(VENUES[0])).toBeGreaterThan(rankingScore(low));
  });

  it("rankSearchResults: immutable", () => {
    const original = VENUES.map((v) => v.venueId);
    rankSearchResults(VENUES);
    expect(VENUES.map((v) => v.venueId)).toEqual(original);
  });

  it("rankSearchResults: sponsored appears at top despite low rating", () => {
    const ranked = rankSearchResults(VENUES);
    expect(ranked[0].venueId).toBe("v3"); // sponsored boosts it
  });

  it("custom weights: price matters more", () => {
    const budgetWeights: SearchWeights = { ...DEFAULT_WEIGHTS, price: -20 };
    const ranked = rankSearchResults(VENUES, budgetWeights);
    // Premium (v2, price 3) gets penalized more
    expect(ranked[ranked.length - 1].venueId).not.toBe("v1"); // v1 is budget
  });
});
