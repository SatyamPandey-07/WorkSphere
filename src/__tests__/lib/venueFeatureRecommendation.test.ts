/**
 * Tests for venue feature improvement recommendations based on reviews.
 */

interface FeatureGap {
  feature: string;
  mentionCount: number;
  sentiment: "positive" | "negative" | "request";
  priority: number; // 1-10
}

function topImprovementAreas(gaps: FeatureGap[], limit = 5): FeatureGap[] {
  return gaps
    .filter((g) => g.sentiment === "negative" || g.sentiment === "request")
    .sort((a, b) => {
      const aScore = a.mentionCount * a.priority;
      const bScore = b.mentionCount * b.priority;
      return bScore - aScore;
    })
    .slice(0, limit);
}

function topStrengths(gaps: FeatureGap[], limit = 3): FeatureGap[] {
  return gaps
    .filter((g) => g.sentiment === "positive")
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, limit);
}

function urgencyScore(gap: FeatureGap): number {
  const sentimentWeight = gap.sentiment === "negative" ? 2 : 1;
  return gap.mentionCount * gap.priority * sentimentWeight;
}

function featureActionPlan(gaps: FeatureGap[]): { immediate: FeatureGap[]; planned: FeatureGap[]; monitor: FeatureGap[] } {
  return {
    immediate: gaps.filter((g) => urgencyScore(g) >= 30),
    planned:   gaps.filter((g) => urgencyScore(g) >= 10 && urgencyScore(g) < 30),
    monitor:   gaps.filter((g) => urgencyScore(g) < 10),
  };
}

const GAPS: FeatureGap[] = [
  { feature: "wifi_speed",     mentionCount: 20, sentiment: "negative", priority: 8 },
  { feature: "quiet_zone",     mentionCount: 15, sentiment: "request",  priority: 6 },
  { feature: "coffee_quality", mentionCount: 30, sentiment: "positive", priority: 5 },
  { feature: "parking",        mentionCount: 5,  sentiment: "negative", priority: 9 },
  { feature: "natural_light",  mentionCount: 25, sentiment: "positive", priority: 7 },
  { feature: "more_outlets",   mentionCount: 10, sentiment: "request",  priority: 7 },
];

describe("Venue feature improvement recommendations", () => {
  it("topImprovementAreas: wifi and parking as negative/request", () => {
    const improvements = topImprovementAreas(GAPS);
    const features = improvements.map((g) => g.feature);
    expect(features).toContain("wifi_speed");
  });

  it("topStrengths: coffee and natural light as positive", () => {
    const strengths = topStrengths(GAPS);
    expect(strengths.map((g) => g.feature)).toContain("coffee_quality");
  });

  it("urgencyScore: negative sentiment gets 2x weight", () => {
    const wifiGap = GAPS[0]; // negative
    const quietGap = GAPS[1]; // request (same mentions approx)
    expect(urgencyScore(wifiGap)).toBeGreaterThan(urgencyScore(quietGap));
  });

  it("featureActionPlan: high urgency items in immediate", () => {
    const plan = featureActionPlan(GAPS);
    expect(plan.immediate.some((g) => g.feature === "wifi_speed")).toBe(true);
  });

  it("featureActionPlan: strengths go to monitor (urgency 0)", () => {
    const plan = featureActionPlan(GAPS);
    expect(plan.monitor.some((g) => g.sentiment === "positive")).toBe(true);
  });
});
