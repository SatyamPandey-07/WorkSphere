/**
 * Tests for venue booking value proposition scoring.
 */

interface ValueProposition {
  priceValue: number;      // 0-100 (value for price)
  locationValue: number;   // 0-100
  amenityValue: number;    // 0-100
  experienceValue: number; // 0-100
  uniquenessScore: number; // 0-100
}

function overallValueScore(vp: ValueProposition): number {
  return Math.round(
    vp.priceValue * 0.3 +
    vp.locationValue * 0.25 +
    vp.amenityValue * 0.2 +
    vp.experienceValue * 0.15 +
    vp.uniquenessScore * 0.1
  );
}

function valueCategory(score: number): "exceptional" | "excellent" | "good" | "average" | "below_average" {
  if (score >= 85) return "exceptional";
  if (score >= 70) return "excellent";
  if (score >= 55) return "good";
  if (score >= 40) return "average";
  return "below_average";
}

function competitiveAdvantage(
  venue: ValueProposition,
  marketAvg: ValueProposition
): string[] {
  const advantages: string[] = [];
  if (venue.priceValue > marketAvg.priceValue + 10) advantages.push("Better price value");
  if (venue.locationValue > marketAvg.locationValue + 10) advantages.push("Superior location");
  if (venue.amenityValue > marketAvg.amenityValue + 10) advantages.push("Better amenities");
  if (venue.uniquenessScore > marketAvg.uniquenessScore + 15) advantages.push("Unique offering");
  return advantages;
}

function improvementPriorities(vp: ValueProposition): string[] {
  const dimensions: { name: string; value: number; weight: number }[] = [
    { name: "Price value",  value: vp.priceValue,      weight: 0.3 },
    { name: "Location",     value: vp.locationValue,   weight: 0.25 },
    { name: "Amenities",    value: vp.amenityValue,    weight: 0.2 },
    { name: "Experience",   value: vp.experienceValue, weight: 0.15 },
    { name: "Uniqueness",   value: vp.uniquenessScore, weight: 0.1 },
  ];

  return dimensions
    .filter((d) => d.value < 60) // below threshold
    .sort((a, b) => b.weight - a.weight) // prioritize by weight
    .map((d) => d.name);
}

const GOOD_VP: ValueProposition = { priceValue: 85, locationValue: 90, amenityValue: 75, experienceValue: 80, uniquenessScore: 60 };
const AVG_VP: ValueProposition = { priceValue: 60, locationValue: 65, amenityValue: 55, experienceValue: 50, uniquenessScore: 45 };
const MARKET_AVG: ValueProposition = { priceValue: 65, locationValue: 70, amenityValue: 65, experienceValue: 60, uniquenessScore: 50 };

describe("Venue value proposition scoring", () => {
  it("overallValueScore: good VP → high score", () => {
    expect(overallValueScore(GOOD_VP)).toBeGreaterThan(75);
  });

  it("overallValueScore: average VP → mid range", () => {
    const avg = overallValueScore(AVG_VP);
    expect(avg).toBeGreaterThan(40);
    expect(avg).toBeLessThan(75);
  });

  it("valueCategory: 85+ → exceptional", () => {
    expect(valueCategory(85)).toBe("exceptional");
  });

  it("valueCategory: 45 → average", () => {
    expect(valueCategory(45)).toBe("average");
  });

  it("competitiveAdvantage: better location and price", () => {
    const advantages = competitiveAdvantage(GOOD_VP, MARKET_AVG);
    expect(advantages).toContain("Better price value");
    expect(advantages).toContain("Superior location");
  });

  it("improvementPriorities: avg VP has priorities", () => {
    const priorities = improvementPriorities(AVG_VP);
    expect(priorities.length).toBeGreaterThan(0);
  });
});
