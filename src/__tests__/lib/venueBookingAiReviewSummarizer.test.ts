/**
 * Tests for AI-powered review summarization.
 */

interface ReviewSummary {
  venueId: string;
  totalReviews: number;
  positiveThemes: string[];
  negativeThemes: string[];
  keyInsight: string;
  recommendationScore: number;  // 0-100
  lastUpdated: number;
}

function buildSummaryFromReviews(
  reviews: { rating: number; tags: string[]; text: string }[]
): Omit<ReviewSummary, "venueId" | "lastUpdated"> {
  const positiveReviews = reviews.filter((r) => r.rating >= 4);
  const negativeReviews = reviews.filter((r) => r.rating <= 2);

  const positiveTags = positiveReviews.flatMap((r) => r.tags);
  const negativeTags = negativeReviews.flatMap((r) => r.tags);

  const uniquePositive = [...new Set(positiveTags)].slice(0, 5);
  const uniqueNegative = [...new Set(negativeTags)].slice(0, 5);

  const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  const recommendationScore = Math.round((avgRating / 5) * 100);

  const keyInsight = avgRating >= 4.5
    ? "Highly recommended by guests"
    : avgRating >= 3.5
    ? "Generally positive with some areas for improvement"
    : "Mixed reviews - check specific concerns";

  return {
    totalReviews: reviews.length,
    positiveThemes: uniquePositive,
    negativeThemes: uniqueNegative,
    keyInsight,
    recommendationScore,
  };
}

function freshnessDays(summary: ReviewSummary, nowMs: number): number {
  return Math.floor((nowMs - summary.lastUpdated) / 86_400_000);
}

function isSummaryStale(summary: ReviewSummary, nowMs: number, staleAfterDays = 7): boolean {
  return freshnessDays(summary, nowMs) > staleAfterDays;
}

const NOW = 1_700_000_000_000;
const REVIEWS = [
  { rating: 5, tags: ["wifi", "quiet", "coffee"], text: "Great workspace!" },
  { rating: 4, tags: ["wifi", "location"],        text: "Good overall"     },
  { rating: 5, tags: ["staff", "quiet"],          text: "Very professional"},
  { rating: 2, tags: ["noise", "crowded"],        text: "Too noisy"        },
  { rating: 3, tags: ["parking"],                 text: "Parking was hard" },
];

describe("AI review summarizer", () => {
  it("buildSummaryFromReviews: correct total", () => {
    const summary = buildSummaryFromReviews(REVIEWS);
    expect(summary.totalReviews).toBe(5);
  });

  it("buildSummaryFromReviews: positive themes from 4-5 star reviews", () => {
    const summary = buildSummaryFromReviews(REVIEWS);
    expect(summary.positiveThemes).toContain("wifi");
    expect(summary.positiveThemes).toContain("quiet");
  });

  it("buildSummaryFromReviews: negative themes from 1-2 star reviews", () => {
    const summary = buildSummaryFromReviews(REVIEWS);
    expect(summary.negativeThemes).toContain("noise");
  });

  it("buildSummaryFromReviews: recommendation score based on avg", () => {
    const summary = buildSummaryFromReviews(REVIEWS);
    // avg = (5+4+5+2+3)/5 = 3.8 → 76%
    expect(summary.recommendationScore).toBeCloseTo(76, 0);
  });

  it("buildSummaryFromReviews: key insight for high average", () => {
    const allGood = [{ rating: 5, tags: ["wifi"], text: "Perfect" }];
    const summary = buildSummaryFromReviews(allGood);
    expect(summary.keyInsight).toContain("Highly recommended");
  });

  it("isSummaryStale: 8 days old → stale", () => {
    const oldSummary: ReviewSummary = {
      venueId: "v1", totalReviews: 5, positiveThemes: [],
      negativeThemes: [], keyInsight: "", recommendationScore: 80,
      lastUpdated: NOW - 8 * 86_400_000,
    };
    expect(isSummaryStale(oldSummary, NOW)).toBe(true);
  });

  it("isSummaryStale: fresh summary → false", () => {
    const fresh: ReviewSummary = {
      venueId: "v1", totalReviews: 5, positiveThemes: [],
      negativeThemes: [], keyInsight: "", recommendationScore: 80,
      lastUpdated: NOW - 1 * 86_400_000,
    };
    expect(isSummaryStale(fresh, NOW)).toBe(false);
  });
});
