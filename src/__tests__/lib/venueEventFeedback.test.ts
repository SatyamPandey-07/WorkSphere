/**
 * Tests for venue event post-feedback collection and NPS.
 */

interface EventFeedback {
  feedbackId: string;
  eventId: string;
  attendeeId: string;
  npsScore: number;      // 0-10
  overallRating: number; // 1-5
  wouldAttendAgain: boolean;
  highlights: string[];
  improvementAreas: string[];
  submittedAt: number;
}

function npsCategory(score: number): "detractor" | "passive" | "promoter" {
  if (score <= 6)  return "detractor";
  if (score <= 8)  return "passive";
  return "promoter";
}

function calculateNps(feedbacks: EventFeedback[]): number {
  if (feedbacks.length === 0) return 0;
  const promoters = feedbacks.filter((f) => npsCategory(f.npsScore) === "promoter").length;
  const detractors = feedbacks.filter((f) => npsCategory(f.npsScore) === "detractor").length;
  return Math.round(((promoters - detractors) / feedbacks.length) * 100);
}

function avgRating(feedbacks: EventFeedback[]): number {
  if (feedbacks.length === 0) return 0;
  return Math.round((feedbacks.reduce((s, f) => s + f.overallRating, 0) / feedbacks.length) * 10) / 10;
}

function wouldAttendAgainRate(feedbacks: EventFeedback[]): number {
  if (feedbacks.length === 0) return 0;
  return Math.round((feedbacks.filter((f) => f.wouldAttendAgain).length / feedbacks.length) * 100);
}

function topHighlights(feedbacks: EventFeedback[], limit = 5): string[] {
  const counts: Record<string, number> = {};
  feedbacks.forEach((f) => f.highlights.forEach((h) => { counts[h] = (counts[h] ?? 0) + 1; }));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([h]) => h);
}

const FEEDBACKS: EventFeedback[] = [
  { feedbackId: "f1", eventId: "e1", attendeeId: "u1", npsScore: 9, overallRating: 5, wouldAttendAgain: true,  highlights: ["networking", "content"],    improvementAreas: [], submittedAt: 0 },
  { feedbackId: "f2", eventId: "e1", attendeeId: "u2", npsScore: 7, overallRating: 4, wouldAttendAgain: true,  highlights: ["content", "venue"],          improvementAreas: ["duration"], submittedAt: 0 },
  { feedbackId: "f3", eventId: "e1", attendeeId: "u3", npsScore: 5, overallRating: 3, wouldAttendAgain: false, highlights: [],                            improvementAreas: ["audio"],    submittedAt: 0 },
];

describe("Venue event post-feedback", () => {
  it("npsCategory: 9 → promoter", () => {
    expect(npsCategory(9)).toBe("promoter");
  });

  it("npsCategory: 7 → passive", () => {
    expect(npsCategory(7)).toBe("passive");
  });

  it("npsCategory: 5 → detractor", () => {
    expect(npsCategory(5)).toBe("detractor");
  });

  it("calculateNps: 1 promoter - 1 detractor = 0% NPS", () => {
    expect(calculateNps(FEEDBACKS)).toBe(0);
  });

  it("avgRating: (5+4+3)/3 ≈ 4.0", () => {
    expect(avgRating(FEEDBACKS)).toBeCloseTo(4.0, 1);
  });

  it("wouldAttendAgainRate: 2/3 = 67%", () => {
    expect(wouldAttendAgainRate(FEEDBACKS)).toBe(67);
  });

  it("topHighlights: content appears most", () => {
    const highlights = topHighlights(FEEDBACKS);
    expect(highlights[0]).toBe("content"); // appears twice
  });

  it("calculateNps: empty feedbacks → 0", () => {
    expect(calculateNps([])).toBe(0);
  });
});
