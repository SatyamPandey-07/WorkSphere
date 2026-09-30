/**
 * Tests for venue space productivity score computation.
 */

interface ProductivityFactors {
  wifiReliability: number;   // 0-10
  noiseLevel: number;        // 0-10 (0=silent, 10=loud) - LOWER is better
  seating: number;           // 0-10 comfort score
  lightingQuality: number;   // 0-10
  airQuality: number;        // 0-10
  distraction: number;       // 0-10 (0=no distraction) - LOWER is better
}

function productivityScore(factors: ProductivityFactors): number {
  const positives = factors.wifiReliability + factors.seating + factors.lightingQuality + factors.airQuality;
  const negatives = factors.noiseLevel + factors.distraction;
  const raw = ((positives / 40) - (negatives / 20)) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function isGoodForDeepWork(factors: ProductivityFactors): boolean {
  return (
    factors.wifiReliability >= 7 &&
    factors.noiseLevel <= 3 &&
    factors.lightingQuality >= 6 &&
    factors.distraction <= 2
  );
}

function productivityLabel(score: number): "poor" | "fair" | "good" | "excellent" {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

function improvementSuggestions(factors: ProductivityFactors): string[] {
  const suggestions: string[] = [];
  if (factors.noiseLevel > 5) suggestions.push("Reduce noise level");
  if (factors.wifiReliability < 6) suggestions.push("Improve WiFi reliability");
  if (factors.lightingQuality < 5) suggestions.push("Improve lighting");
  if (factors.airQuality < 5) suggestions.push("Improve ventilation");
  if (factors.distraction > 5) suggestions.push("Reduce distractions");
  return suggestions;
}

const EXCELLENT: ProductivityFactors = {
  wifiReliability: 9, noiseLevel: 1, seating: 8, lightingQuality: 9, airQuality: 8, distraction: 1,
};
const POOR: ProductivityFactors = {
  wifiReliability: 3, noiseLevel: 8, seating: 4, lightingQuality: 3, airQuality: 3, distraction: 7,
};

describe("Venue space productivity", () => {
  it("productivityScore: excellent factors = high score", () => {
    expect(productivityScore(EXCELLENT)).toBeGreaterThan(70);
  });

  it("productivityScore: clamped 0-100", () => {
    expect(productivityScore(EXCELLENT)).toBeLessThanOrEqual(100);
    expect(productivityScore(POOR)).toBeGreaterThanOrEqual(0);
  });

  it("isGoodForDeepWork: excellent factors → true", () => {
    expect(isGoodForDeepWork(EXCELLENT)).toBe(true);
  });

  it("isGoodForDeepWork: high noise → false", () => {
    expect(isGoodForDeepWork(POOR)).toBe(false);
  });

  it("productivityLabel: excellent score", () => {
    expect(productivityLabel(productivityScore(EXCELLENT))).toBe("excellent");
  });

  it("productivityLabel: poor score", () => {
    expect(productivityLabel(20)).toBe("poor");
  });

  it("improvementSuggestions: poor factors → multiple suggestions", () => {
    const suggestions = improvementSuggestions(POOR);
    expect(suggestions.length).toBeGreaterThan(1);
  });

  it("improvementSuggestions: excellent factors → none", () => {
    expect(improvementSuggestions(EXCELLENT)).toHaveLength(0);
  });
});
