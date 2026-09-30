/**
 * Tests for venue booking NPS (Net Promoter Score) and guest feedback analysis.
 */

type NpsCategory = "promoter" | "passive" | "detractor";

interface NpsSurveyResponse {
  respondentId: string;
  bookingId: string;
  score: number;         // 0-10
  comment: string;
  submittedAt: number;
  followUpDone: boolean;
}

function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

function npsScore(responses: NpsSurveyResponse[]): number {
  if (responses.length === 0) return 0;
  const promoters  = responses.filter((r) => npsCategory(r.score) === "promoter").length;
  const detractors = responses.filter((r) => npsCategory(r.score) === "detractor").length;
  return Math.round(((promoters - detractors) / responses.length) * 100);
}

function avgScore(responses: NpsSurveyResponse[]): number {
  if (responses.length === 0) return 0;
  return Math.round(responses.reduce((s, r) => s + r.score, 0) / responses.length * 10) / 10;
}

function distributionByCategory(responses: NpsSurveyResponse[]): Record<NpsCategory, number> {
  const dist: Record<NpsCategory, number> = { promoter: 0, passive: 0, detractor: 0 };
  for (const r of responses) dist[npsCategory(r.score)]++;
  return dist;
}

function pendingFollowUps(responses: NpsSurveyResponse[]): NpsSurveyResponse[] {
  return responses.filter((r) => !r.followUpDone && npsCategory(r.score) === "detractor");
}

const RESPONSES: NpsSurveyResponse[] = [
  { respondentId: "r1", bookingId: "b1", score: 9,  comment: "Great!",     submittedAt: 1_700_000_000_000, followUpDone: false },
  { respondentId: "r2", bookingId: "b2", score: 10, comment: "Excellent!",  submittedAt: 1_700_000_000_001, followUpDone: false },
  { respondentId: "r3", bookingId: "b3", score: 6,  comment: "Average",     submittedAt: 1_700_000_000_002, followUpDone: false },
  { respondentId: "r4", bookingId: "b4", score: 3,  comment: "Disappointing", submittedAt: 1_700_000_000_003, followUpDone: false },
];

describe("NPS and guest feedback analysis", () => {
  it("npsCategory: 9 → promoter", () => {
    expect(npsCategory(9)).toBe("promoter");
  });

  it("npsCategory: 7 → passive", () => {
    expect(npsCategory(7)).toBe("passive");
  });

  it("npsCategory: 5 → detractor", () => {
    expect(npsCategory(5)).toBe("detractor");
  });

  it("npsScore: 2 promoters, 1 detractor = 25", () => {
    expect(npsScore(RESPONSES)).toBe(25);
  });

  it("avgScore: (9+10+6+3)/4 = 7.0", () => {
    expect(avgScore(RESPONSES)).toBe(7.0);
  });

  it("pendingFollowUps: 1 unfollowed detractor", () => {
    expect(pendingFollowUps(RESPONSES).length).toBe(1);
  });
});
