/**
 * Tests for venue recommendation scoring algorithm.
 */

interface UserPrefs {
  preferredAmenities: string[];
  maxDistanceKm: number;
  minRating: number;
  budget: "free" | "budget" | "standard" | "premium";
}

interface VenueCandidate {
  id: string;
  amenities: string[];
  distanceKm: number;
  rating: number;
  priceCategory: "free" | "budget" | "standard" | "premium";
}

const BUDGET_RANK: Record<string, number> = { free: 0, budget: 1, standard: 2, premium: 3 };

function matchesPrefs(venue: VenueCandidate, prefs: UserPrefs): boolean {
  if (venue.distanceKm > prefs.maxDistanceKm) return false;
  if (venue.rating < prefs.minRating) return false;
  if (BUDGET_RANK[venue.priceCategory] > BUDGET_RANK[prefs.budget]) return false;
  return true;
}

function amenityMatch(venue: VenueCandidate, prefs: UserPrefs): number {
  return prefs.preferredAmenities.filter((a) => venue.amenities.includes(a)).length;
}

function recommendationScore(venue: VenueCandidate, prefs: UserPrefs): number {
  if (!matchesPrefs(venue, prefs)) return -1;
  return venue.rating * 20 + amenityMatch(venue, prefs) * 10 - venue.distanceKm * 2;
}

function topRecommendations(
  venues: VenueCandidate[],
  prefs: UserPrefs,
  limit: number
): VenueCandidate[] {
  return venues
    .map((v) => ({ venue: v, score: recommendationScore(v, prefs) }))
    .filter((v) => v.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((v) => v.venue);
}

const PREFS: UserPrefs = {
  preferredAmenities: ["wifi", "outlets"],
  maxDistanceKm: 5,
  minRating: 3.5,
  budget: "standard",
};

const VENUES: VenueCandidate[] = [
  { id: "v1", amenities: ["wifi", "outlets", "parking"], distanceKm: 1, rating: 4.5, priceCategory: "standard" },
  { id: "v2", amenities: ["wifi"],                        distanceKm: 3, rating: 4.0, priceCategory: "budget"   },
  { id: "v3", amenities: [],                              distanceKm: 0.5, rating: 3.0, priceCategory: "free"   }, // below min rating
  { id: "v4", amenities: ["wifi", "outlets"],             distanceKm: 8, rating: 4.8, priceCategory: "standard" }, // too far
];

describe("Venue recommendation algorithm", () => {
  it("matchesPrefs: v1 matches all prefs", () => {
    expect(matchesPrefs(VENUES[0], PREFS)).toBe(true);
  });

  it("matchesPrefs: v3 fails min rating", () => {
    expect(matchesPrefs(VENUES[2], PREFS)).toBe(false);
  });

  it("matchesPrefs: v4 fails max distance", () => {
    expect(matchesPrefs(VENUES[3], PREFS)).toBe(false);
  });

  it("amenityMatch: v1 matches 2 of 2 preferred", () => {
    expect(amenityMatch(VENUES[0], PREFS)).toBe(2);
  });

  it("amenityMatch: v2 matches 1 of 2 preferred", () => {
    expect(amenityMatch(VENUES[1], PREFS)).toBe(1);
  });

  it("recommendationScore: v3 (below rating) returns -1", () => {
    expect(recommendationScore(VENUES[2], PREFS)).toBe(-1);
  });

  it("topRecommendations: max 2, filtered", () => {
    const recs = topRecommendations(VENUES, PREFS, 2);
    expect(recs).toHaveLength(2);
    expect(recs.every((v) => matchesPrefs(v, PREFS))).toBe(true);
  });

  it("topRecommendations: highest scored first", () => {
    const recs = topRecommendations(VENUES, PREFS, 5);
    expect(recommendationScore(recs[0], PREFS)).toBeGreaterThan(recommendationScore(recs[1], PREFS));
  });
});
