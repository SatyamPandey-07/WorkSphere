/**
 * Tests for comprehensive booking recommendation engine.
 */

interface UserPreferenceVector {
  userId: string;
  categoryWeights: Record<string, number>;  // category → weight 0-1
  priceWeight: number;     // 0-1 (1=price-sensitive)
  locationWeight: number;  // 0-1 (1=location-sensitive)
  ratingWeight: number;    // 0-1 (1=rating-sensitive)
}

interface VenueFeatureVector {
  venueId: string;
  category: string;
  priceCents: number;
  maxPriceCents: number;
  distanceKm: number;
  maxDistanceKm: number;
  rating: number;
}

function normalizeFeature(value: number, max: number): number {
  if (max === 0) return 0;
  return value / max;
}

function recommendationScore(user: UserPreferenceVector, venue: VenueFeatureVector): number {
  const categoryMatch = user.categoryWeights[venue.category] ?? 0;
  const priceScore = 1 - normalizeFeature(venue.priceCents, venue.maxPriceCents);
  const locationScore = 1 - normalizeFeature(venue.distanceKm, venue.maxDistanceKm);
  const ratingScore = venue.rating / 5;

  return (
    categoryMatch * 0.35 +
    priceScore * user.priceWeight * 0.25 +
    locationScore * user.locationWeight * 0.25 +
    ratingScore * user.ratingWeight * 0.15
  );
}

function topKRecommendations(
  user: UserPreferenceVector,
  venues: VenueFeatureVector[],
  k: number
): string[] {
  return [...venues]
    .map((v) => ({ venueId: v.venueId, score: recommendationScore(user, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((v) => v.venueId);
}

function diversifyByCategory(
  recommendations: string[],
  venues: VenueFeatureVector[],
  maxPerCategory = 2
): string[] {
  const counts: Record<string, number> = {};
  return recommendations.filter((id) => {
    const venue = venues.find((v) => v.venueId === id);
    if (!venue) return true;
    const count = counts[venue.category] ?? 0;
    if (count >= maxPerCategory) return false;
    counts[venue.category] = count + 1;
    return true;
  });
}

const USER: UserPreferenceVector = {
  userId: "u1",
  categoryWeights: { cafe: 0.8, coworking: 0.6, library: 0.3 },
  priceWeight: 0.7, locationWeight: 0.9, ratingWeight: 0.8,
};

const VENUES: VenueFeatureVector[] = [
  { venueId: "v1", category: "cafe",      priceCents: 500,  maxPriceCents: 2000, distanceKm: 0.5, maxDistanceKm: 10, rating: 4.5 },
  { venueId: "v2", category: "coworking", priceCents: 1000, maxPriceCents: 2000, distanceKm: 1.0, maxDistanceKm: 10, rating: 4.2 },
  { venueId: "v3", category: "cafe",      priceCents: 400,  maxPriceCents: 2000, distanceKm: 0.3, maxDistanceKm: 10, rating: 4.8 },
];

describe("Venue booking recommendation engine", () => {
  it("recommendationScore: higher for matching category and preferences", () => {
    const cafeScore = recommendationScore(USER, VENUES[0]);
    const coworkScore = recommendationScore(USER, VENUES[1]);
    expect(cafeScore).toBeGreaterThan(coworkScore);
  });

  it("topKRecommendations: returns top k venues", () => {
    const top2 = topKRecommendations(USER, VENUES, 2);
    expect(top2).toHaveLength(2);
  });

  it("topKRecommendations: sorted by score (best first)", () => {
    const top3 = topKRecommendations(USER, VENUES, 3);
    const scores = top3.map((id) => recommendationScore(USER, VENUES.find((v) => v.venueId === id)!));
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
  });

  it("diversifyByCategory: max 1 cafe removes second cafe", () => {
    const recs = topKRecommendations(USER, VENUES, 3);
    const diverse = diversifyByCategory(recs, VENUES, 1);
    const cafes = diverse.filter((id) => VENUES.find((v) => v.venueId === id)?.category === "cafe");
    expect(cafes).toHaveLength(1);
  });
});
