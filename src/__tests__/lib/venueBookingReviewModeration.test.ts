/**
 * Tests for venue review moderation and sentiment analysis utilities.
 */

type ModerationFlag = "spam" | "offensive" | "fake" | "competitor_mention" | "personal_info";
type ModerationStatus = "pending" | "approved" | "rejected" | "escalated";

interface Review {
  id: string;
  venueId: string;
  userId: string;
  rating: number;     // 1-5
  text: string;
  wordCount: number;
  submittedAt: number;
  flags: ModerationFlag[];
  status: ModerationStatus;
}

function isLikelySpam(review: Review): boolean {
  return review.wordCount < 5 || review.flags.includes("spam") || review.flags.includes("fake");
}

function requiresEscalation(review: Review): boolean {
  return review.flags.includes("personal_info") || review.flags.includes("offensive");
}

function autoModerationDecision(review: Review): ModerationStatus {
  if (requiresEscalation(review)) return "escalated";
  if (isLikelySpam(review)) return "rejected";
  if (review.flags.length === 0 && review.wordCount >= 20) return "approved";
  return "pending";
}

function venueAvgRating(reviews: Review[]): number {
  const approved = reviews.filter((r) => r.status === "approved");
  if (approved.length === 0) return 0;
  return Math.round(approved.reduce((s, r) => s + r.rating, 0) / approved.length * 10) / 10;
}

function ratingDistribution(reviews: Review[]): Record<number, number> {
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reviews.filter((r) => r.status === "approved")) {
    dist[r.rating] = (dist[r.rating] ?? 0) + 1;
  }
  return dist;
}

function flaggedCount(reviews: Review[], flag: ModerationFlag): number {
  return reviews.filter((r) => r.flags.includes(flag)).length;
}

const REVIEWS: Review[] = [
  { id: "r1", venueId: "v1", userId: "u1", rating: 5, text: "Amazing venue!", wordCount: 25, submittedAt: 1_700_000_000_000, flags: [],          status: "approved" },
  { id: "r2", venueId: "v1", userId: "u2", rating: 1, text: "Bad",            wordCount: 3,  submittedAt: 1_700_000_000_001, flags: ["spam"],     status: "pending" },
  { id: "r3", venueId: "v1", userId: "u3", rating: 4, text: "Good place",     wordCount: 22, submittedAt: 1_700_000_000_002, flags: ["offensive"],status: "pending" },
];

describe("Review moderation", () => {
  it("isLikelySpam: 3-word review → spam", () => {
    expect(isLikelySpam(REVIEWS[1])).toBe(true);
  });

  it("isLikelySpam: 25-word review no flags → not spam", () => {
    expect(isLikelySpam(REVIEWS[0])).toBe(false);
  });

  it("requiresEscalation: offensive flag → true", () => {
    expect(requiresEscalation(REVIEWS[2])).toBe(true);
  });

  it("autoModerationDecision: clean long review → approved", () => {
    expect(autoModerationDecision(REVIEWS[0])).toBe("approved");
  });

  it("venueAvgRating: only r1 approved → 5.0", () => {
    expect(venueAvgRating(REVIEWS)).toBe(5);
  });

  it("flaggedCount: 1 offensive review", () => {
    expect(flaggedCount(REVIEWS, "offensive")).toBe(1);
  });
});
