import {
  scoreComment,
  summarizeReviewSentiment,
  type SentimentReview,
} from "@/lib/reviewSentiment";

const positiveReview: SentimentReview = {
  comment: "Great quiet spot, love the fast wifi",
  wifiQuality: 5,
  noiseLevel: "quiet",
  hasOutlets: true,
};

const negativeReview: SentimentReview = {
  comment: "Terrible, noisy and slow wifi",
  wifiQuality: 1,
  noiseLevel: "loud",
  hasOutlets: false,
};

describe("scoreComment", () => {
  it("scores positive and negative words", () => {
    expect(scoreComment("Great place")).toBe(1);
    expect(scoreComment("Terrible and noisy")).toBe(-1);
    expect(scoreComment("great but noisy")).toBe(0);
  });

  it("flips sentiment after a negation", () => {
    expect(scoreComment("not bad")).toBe(1);
    expect(scoreComment("not good")).toBe(-1);
    expect(scoreComment("not very good")).toBe(-1);
  });

  it("returns null when there are no sentiment words", () => {
    expect(scoreComment("The table is round")).toBeNull();
    expect(scoreComment("")).toBeNull();
    expect(scoreComment(null)).toBeNull();
    expect(scoreComment(undefined)).toBeNull();
  });
});

describe("summarizeReviewSentiment", () => {
  it("labels clearly positive reviews and lists what people loved", () => {
    const summary = summarizeReviewSentiment([
      positiveReview,
      positiveReview,
      positiveReview,
      positiveReview,
    ]);
    expect(summary?.label).toBe("positive");
    expect(summary?.score).toBeCloseTo(1);
    expect(summary?.reviewCount).toBe(4);
    expect(summary?.highlights).toEqual([
      "Quiet atmosphere",
      "Fast WiFi",
      "Plenty of outlets",
    ]);
  });

  it("labels clearly negative reviews as needs improvement, without highlights", () => {
    const summary = summarizeReviewSentiment([
      negativeReview,
      negativeReview,
      negativeReview,
    ]);
    expect(summary?.label).toBe("needs_improvement");
    expect(summary?.highlights).toEqual([]);
  });

  it("labels an even split as mixed", () => {
    const summary = summarizeReviewSentiment([
      { comment: "Great place", wifiQuality: 5, noiseLevel: "quiet" },
      { comment: "Great place", wifiQuality: 5, noiseLevel: "quiet" },
      { comment: "Terrible and noisy", wifiQuality: 1, noiseLevel: "loud" },
      { comment: "Terrible and noisy", wifiQuality: 1, noiseLevel: "loud" },
    ]);
    expect(summary?.label).toBe("mixed");
    expect(summary?.score).toBeCloseTo(0);
    expect(summary?.highlights).toEqual([]);
  });

  it("returns null when there are too few usable reviews", () => {
    expect(
      summarizeReviewSentiment([positiveReview, positiveReview]),
    ).toBeNull();
    expect(
      summarizeReviewSentiment([{}, {}, { comment: "The table is round" }]),
    ).toBeNull();
    expect(summarizeReviewSentiment([])).toBeNull();
    expect(summarizeReviewSentiment(null)).toBeNull();
  });

  it("uses structured ratings when reviews have no comment", () => {
    const rated: SentimentReview = { wifiQuality: 5, noiseLevel: "quiet" };
    const summary = summarizeReviewSentiment([rated, rated, rated]);
    expect(summary?.label).toBe("positive");
    expect(summary?.highlights).toEqual(["Quiet atmosphere", "Fast WiFi"]);
  });

  it("highlights comfortable seating mentioned in positive comments", () => {
    const seating: SentimentReview = {
      comment: "Comfortable seating and great chairs",
    };
    const summary = summarizeReviewSentiment([seating, seating, seating]);
    expect(summary?.label).toBe("positive");
    expect(summary?.highlights).toEqual(["Comfortable seating"]);
  });

  it("only considers the 50 most recent reviews", () => {
    const old = Array.from({ length: 3 }, () => ({
      comment: "Terrible and noisy",
      createdAt: "2020-01-01T00:00:00Z",
    }));
    const recent = Array.from({ length: 50 }, (_, i) => ({
      comment: "Great place",
      createdAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const summary = summarizeReviewSentiment([...old, ...recent]);
    expect(summary?.reviewCount).toBe(50);
    expect(summary?.label).toBe("positive");
  });
});
