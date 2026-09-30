/**
 * Tests for recommendation diversity to avoid filter bubbles.
 */

interface VenueRecommendation {
  venueId: string;
  category: string;
  priceRange: "budget" | "mid" | "premium";
  distance: "nearby" | "moderate" | "far";
  score: number;
}

function diversifyRecommendations(
  recommendations: VenueRecommendation[],
  maxPerCategory = 2,
  maxPerPriceRange = 2
): VenueRecommendation[] {
  const categoryCounts: Record<string, number> = {};
  const priceCounts: Record<string, number> = {};
  const result: VenueRecommendation[] = [];

  const sorted = [...recommendations].sort((a, b) => b.score - a.score);

  for (const rec of sorted) {
    const catCount = categoryCounts[rec.category] ?? 0;
    const priceCount = priceCounts[rec.priceRange] ?? 0;
    if (catCount < maxPerCategory && priceCount < maxPerPriceRange) {
      result.push(rec);
      categoryCounts[rec.category] = catCount + 1;
      priceCounts[rec.priceRange] = priceCount + 1;
    }
  }

  return result;
}

function categoryDiversity(recommendations: VenueRecommendation[]): number {
  const categories = new Set(recommendations.map((r) => r.category));
  return categories.size;
}

function priceRangeDiversity(recommendations: VenueRecommendation[]): number {
  const ranges = new Set(recommendations.map((r) => r.priceRange));
  return ranges.size;
}

const RECOMMENDATIONS: VenueRecommendation[] = [
  { venueId: "v1", category: "cafe",      priceRange: "budget",  distance: "nearby",   score: 90 },
  { venueId: "v2", category: "cafe",      priceRange: "mid",     distance: "nearby",   score: 85 },
  { venueId: "v3", category: "cafe",      priceRange: "budget",  distance: "moderate", score: 80 }, // would be 3rd cafe
  { venueId: "v4", category: "coworking", priceRange: "premium", distance: "moderate", score: 75 },
  { venueId: "v5", category: "library",   priceRange: "budget",  distance: "far",      score: 70 },
  { venueId: "v6", category: "coworking", priceRange: "mid",     distance: "nearby",   score: 65 },
];

describe("Recommendation diversity", () => {
  it("diversifyRecommendations: max 2 per category", () => {
    const diverse = diversifyRecommendations(RECOMMENDATIONS);
    const cafes = diverse.filter((r) => r.category === "cafe");
    expect(cafes).toHaveLength(2);
  });

  it("diversifyRecommendations: includes more than one category", () => {
    const diverse = diversifyRecommendations(RECOMMENDATIONS);
    expect(categoryDiversity(diverse)).toBeGreaterThan(1);
  });

  it("diversifyRecommendations: max 2 per price range", () => {
    const diverse = diversifyRecommendations(RECOMMENDATIONS);
    const budget = diverse.filter((r) => r.priceRange === "budget");
    expect(budget.length).toBeLessThanOrEqual(2);
  });

  it("categoryDiversity: 3 different categories in input", () => {
    expect(categoryDiversity(RECOMMENDATIONS)).toBe(3);
  });

  it("priceRangeDiversity: 3 different price ranges in input", () => {
    expect(priceRangeDiversity(RECOMMENDATIONS)).toBe(3);
  });

  it("diversifyRecommendations: sorted by score within diversity constraints", () => {
    const diverse = diversifyRecommendations(RECOMMENDATIONS);
    expect(diverse[0].venueId).toBe("v1"); // highest score still first
  });
});
