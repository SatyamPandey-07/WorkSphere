/**
 * Tests for AI venue suggestion feedback loop.
 */

type FeedbackType = "helpful" | "not_helpful" | "irrelevant" | "offensive";

interface AiSuggestionFeedback {
  suggestionId: string;
  userId: string;
  type: FeedbackType;
  submittedAt: number;
}

interface SuggestionMetrics {
  suggestionId: string;
  helpful: number;
  not_helpful: number;
  irrelevant: number;
  offensive: number;
  total: number;
}

function aggregateFeedback(
  feedback: AiSuggestionFeedback[],
  suggestionId: string
): SuggestionMetrics {
  const relevant = feedback.filter((f) => f.suggestionId === suggestionId);
  return {
    suggestionId,
    helpful:     relevant.filter((f) => f.type === "helpful").length,
    not_helpful: relevant.filter((f) => f.type === "not_helpful").length,
    irrelevant:  relevant.filter((f) => f.type === "irrelevant").length,
    offensive:   relevant.filter((f) => f.type === "offensive").length,
    total:       relevant.length,
  };
}

function helpfulnessRate(metrics: SuggestionMetrics): number {
  if (metrics.total === 0) return 0;
  return Math.round((metrics.helpful / metrics.total) * 100);
}

function shouldRetireSuggestion(metrics: SuggestionMetrics, threshold = 0.7): boolean {
  if (metrics.total < 5) return false;
  const negRate = (metrics.not_helpful + metrics.irrelevant + metrics.offensive) / metrics.total;
  return negRate >= threshold;
}

const NOW = 1_700_000_000_000;
const FEEDBACK: AiSuggestionFeedback[] = [
  { suggestionId: "s1", userId: "u1", type: "helpful",     submittedAt: NOW - 4000 },
  { suggestionId: "s1", userId: "u2", type: "not_helpful", submittedAt: NOW - 3000 },
  { suggestionId: "s1", userId: "u3", type: "helpful",     submittedAt: NOW - 2000 },
  { suggestionId: "s1", userId: "u4", type: "irrelevant",  submittedAt: NOW - 1000 },
  { suggestionId: "s1", userId: "u5", type: "not_helpful", submittedAt: NOW - 500  },
  { suggestionId: "s2", userId: "u6", type: "helpful",     submittedAt: NOW        },
];

describe("AI suggestion feedback", () => {
  it("aggregateFeedback: s1 has 5 total", () => {
    const m = aggregateFeedback(FEEDBACK, "s1");
    expect(m.total).toBe(5);
    expect(m.helpful).toBe(2);
  });

  it("aggregateFeedback: unknown suggestion → zeros", () => {
    const m = aggregateFeedback(FEEDBACK, "s99");
    expect(m.total).toBe(0);
  });

  it("helpfulnessRate: s1 = 40% (2/5)", () => {
    const m = aggregateFeedback(FEEDBACK, "s1");
    expect(helpfulnessRate(m)).toBe(40);
  });

  it("helpfulnessRate: 0 total → 0", () => {
    const m = aggregateFeedback(FEEDBACK, "s99");
    expect(helpfulnessRate(m)).toBe(0);
  });

  it("shouldRetireSuggestion: 3/5 negative = 60% < 70% → false", () => {
    const m = aggregateFeedback(FEEDBACK, "s1");
    expect(shouldRetireSuggestion(m)).toBe(false);
  });

  it("shouldRetireSuggestion: < 5 total → false regardless", () => {
    const m = aggregateFeedback(FEEDBACK, "s2");
    expect(shouldRetireSuggestion(m)).toBe(false);
  });

  it("shouldRetireSuggestion: high negative rate → true", () => {
    const highNeg: SuggestionMetrics = { suggestionId: "sx", helpful: 1, not_helpful: 5, irrelevant: 2, offensive: 0, total: 8 };
    expect(shouldRetireSuggestion(highNeg)).toBe(true);
  });
});
