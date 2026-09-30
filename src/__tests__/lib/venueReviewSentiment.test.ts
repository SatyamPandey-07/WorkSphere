/**
 * Tests for venue review sentiment classification.
 */

type Sentiment = "positive" | "neutral" | "negative";

function classifyReviewSentiment(rating: number): Sentiment {
  if (rating >= 4)   return "positive";
  if (rating >= 2.5) return "neutral";
  return "negative";
}

function averageRating(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

function sentimentDistribution(ratings: number[]): Record<Sentiment, number> {
  const dist: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
  for (const r of ratings) dist[classifyReviewSentiment(r)]++;
  return dist;
}

describe("Venue review sentiment", () => {
  it("rating 5 → positive", () => {
    expect(classifyReviewSentiment(5)).toBe("positive");
  });

  it("rating 4 → positive (boundary)", () => {
    expect(classifyReviewSentiment(4)).toBe("positive");
  });

  it("rating 3 → neutral", () => {
    expect(classifyReviewSentiment(3)).toBe("neutral");
  });

  it("rating 2.5 → neutral (boundary)", () => {
    expect(classifyReviewSentiment(2.5)).toBe("neutral");
  });

  it("rating 1 → negative", () => {
    expect(classifyReviewSentiment(1)).toBe("negative");
  });

  it("averageRating empty array → 0", () => {
    expect(averageRating([])).toBe(0);
  });

  it("averageRating single value", () => {
    expect(averageRating([4])).toBe(4);
  });

  it("averageRating multiple values", () => {
    expect(averageRating([3, 4, 5])).toBeCloseTo(4);
  });

  it("sentimentDistribution counts correctly", () => {
    const dist = sentimentDistribution([5, 4, 3, 2, 1]);
    expect(dist.positive).toBe(2);
    expect(dist.neutral).toBe(1);
    expect(dist.negative).toBe(2);
  });

  it("sentimentDistribution: all positive", () => {
    const dist = sentimentDistribution([4, 5, 4.5]);
    expect(dist.positive).toBe(3);
    expect(dist.neutral).toBe(0);
  });
});
