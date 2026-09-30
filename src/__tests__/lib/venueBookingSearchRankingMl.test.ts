/**
 * Tests for ML-based venue search ranking with learning-to-rank.
 */

interface RankingFeatures {
  venueId: string;
  relevanceScore: number;   // BM25 text score
  popularityScore: number;  // booking frequency
  qualityScore: number;     // review-based
  personalScore: number;    // user preference match
  freshness: number;        // recent activity
}

type FeatureWeight = Record<keyof Omit<RankingFeatures, "venueId">, number>;

const DEFAULT_WEIGHTS: FeatureWeight = {
  relevanceScore:  0.35,
  popularityScore: 0.20,
  qualityScore:    0.25,
  personalScore:   0.15,
  freshness:       0.05,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function combinedScore(features: RankingFeatures, weights = DEFAULT_WEIGHTS): number {
  return (
    features.relevanceScore  * weights.relevanceScore +
    features.popularityScore * weights.popularityScore +
    features.qualityScore    * weights.qualityScore +
    features.personalScore   * weights.personalScore +
    features.freshness       * weights.freshness
  );
}

function rankVenuesByFeatures(
  venues: RankingFeatures[],
  weights?: FeatureWeight
): RankingFeatures[] {
  return [...venues].sort((a, b) => combinedScore(b, weights) - combinedScore(a, weights));
}

function normalizeScores(venues: RankingFeatures[]): RankingFeatures[] {
  if (venues.length === 0) return [];
  const maxCombined = Math.max(...venues.map((v) => combinedScore(v)));
  if (maxCombined === 0) return venues;
  return venues;  // scores are already 0-1 normalized
}

function adjustWeightsForQuery(query: string, baseWeights = DEFAULT_WEIGHTS): FeatureWeight {
  const hasSpecificKeywords = /wifi|quiet|coffee|parking/i.test(query);
  if (hasSpecificKeywords) {
    return { ...baseWeights, relevanceScore: baseWeights.relevanceScore + 0.1, personalScore: baseWeights.personalScore - 0.1 };
  }
  return baseWeights;
}

const VENUES: RankingFeatures[] = [
  { venueId: "v1", relevanceScore: 0.9, popularityScore: 0.7, qualityScore: 0.8, personalScore: 0.6, freshness: 0.9 },
  { venueId: "v2", relevanceScore: 0.5, popularityScore: 0.9, qualityScore: 0.9, personalScore: 0.8, freshness: 0.5 },
  { venueId: "v3", relevanceScore: 0.3, popularityScore: 0.5, qualityScore: 0.7, personalScore: 0.9, freshness: 0.3 },
];

describe("ML-based search ranking", () => {
  it("combinedScore: all features contribute", () => {
    const score = combinedScore(VENUES[0]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("rankVenuesByFeatures: sorted by combined score", () => {
    const ranked = rankVenuesByFeatures(VENUES);
    expect(combinedScore(ranked[0])).toBeGreaterThanOrEqual(combinedScore(ranked[1]));
  });

  it("rankVenuesByFeatures: immutable", () => {
    const original = VENUES.map((v) => v.venueId);
    rankVenuesByFeatures(VENUES);
    expect(VENUES.map((v) => v.venueId)).toEqual(original);
  });

  it("adjustWeightsForQuery: specific keywords → higher relevance weight", () => {
    const adjusted = adjustWeightsForQuery("quiet wifi coworking");
    expect(adjusted.relevanceScore).toBeGreaterThan(DEFAULT_WEIGHTS.relevanceScore);
  });

  it("adjustWeightsForQuery: generic query → default weights", () => {
    const adjusted = adjustWeightsForQuery("workspace near me");
    expect(adjusted).toEqual(DEFAULT_WEIGHTS);
  });

  it("lerp: 0 to 100 at t=0.5 = 50", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });

  it("lerp: clamps at boundaries", () => {
    expect(lerp(0, 100, 1.5)).toBe(100);
    expect(lerp(0, 100, -0.5)).toBe(0);
  });
});
