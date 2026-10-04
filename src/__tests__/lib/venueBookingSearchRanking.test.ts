/**
 * Tests for venue search ranking algorithm components.
 */

interface RankingFactor {
  name: string;
  score: number;    // 0-1
  weight: number;
  boosted: boolean; // whether this factor is temporarily boosted
}

interface VenueRankResult {
  venueId: string;
  factors: RankingFactor[];
  finalScore: number;
  rank: number;
}

function weightedScore(factors: RankingFactor[]): number {
  const totalWeight = factors.reduce((s, f) => s + (f.boosted ? f.weight * 1.5 : f.weight), 0);
  if (totalWeight === 0) return 0;
  const weightedSum = factors.reduce(
    (s, f) => s + f.score * (f.boosted ? f.weight * 1.5 : f.weight),
    0
  );
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

function rankVenueResults(results: VenueRankResult[]): VenueRankResult[] {
  const sorted = [...results].sort((a, b) => b.finalScore - a.finalScore);
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

function topFactors(factors: RankingFactor[], limit = 3): RankingFactor[] {
  return [...factors]
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, limit);
}

function boostedFactors(factors: RankingFactor[]): RankingFactor[] {
  return factors.filter((f) => f.boosted);
}

function rankingExplanation(factors: RankingFactor[]): string[] {
  return topFactors(factors, 3).map(
    (f) => `${f.name}: ${Math.round(f.score * 100)}%${f.boosted ? " (boosted)" : ""}`
  );
}

const FACTORS_V1: RankingFactor[] = [
  { name: "review_score",    score: 0.95, weight: 0.35, boosted: false },
  { name: "response_rate",   score: 0.88, weight: 0.25, boosted: false },
  { name: "price_value",     score: 0.72, weight: 0.20, boosted: false },
  { name: "recent_bookings", score: 0.60, weight: 0.20, boosted: true },
];

const FACTORS_V2: RankingFactor[] = [
  { name: "review_score",    score: 0.70, weight: 0.35, boosted: false },
  { name: "response_rate",   score: 0.60, weight: 0.25, boosted: false },
  { name: "price_value",     score: 0.50, weight: 0.20, boosted: false },
  { name: "recent_bookings", score: 0.40, weight: 0.20, boosted: false },
];

describe("Search ranking algorithm", () => {
  it("weightedScore: v1 scores higher than v2", () => {
    expect(weightedScore(FACTORS_V1)).toBeGreaterThan(weightedScore(FACTORS_V2));
  });

  it("boostedFactors: recent_bookings is boosted", () => {
    const boosted = boostedFactors(FACTORS_V1);
    expect(boosted.map((f) => f.name)).toContain("recent_bookings");
  });

  it("rankVenueResults: higher scoring venue ranks first", () => {
    const results: VenueRankResult[] = [
      { venueId: "v1", factors: FACTORS_V1, finalScore: weightedScore(FACTORS_V1), rank: 0 },
      { venueId: "v2", factors: FACTORS_V2, finalScore: weightedScore(FACTORS_V2), rank: 0 },
    ];
    const ranked = rankVenueResults(results);
    expect(ranked[0].venueId).toBe("v1");
    expect(ranked[0].rank).toBe(1);
  });

  it("topFactors: returns 3 highest impact factors", () => {
    expect(topFactors(FACTORS_V1).length).toBe(3);
  });

  it("rankingExplanation: returns string array", () => {
    const explanation = rankingExplanation(FACTORS_V1);
    expect(explanation.length).toBe(3);
    expect(typeof explanation[0]).toBe("string");
  });
});
