/**
 * Tests for user-generated content moderation scoring.
 */

type ModerationFlag = "spam" | "offensive" | "misinformation" | "harassment" | "clean";

interface ContentScore {
  text: string;
  spamScore: number;       // 0-1
  offensiveScore: number;  // 0-1
  length: number;
}

function classifyContent(score: ContentScore): ModerationFlag {
  if (score.spamScore > 0.8)     return "spam";
  if (score.offensiveScore > 0.7) return "offensive";
  return "clean";
}

function requiresReview(score: ContentScore): boolean {
  return score.spamScore > 0.5 || score.offensiveScore > 0.4;
}

function isAutoApproved(score: ContentScore): boolean {
  return score.spamScore < 0.2 && score.offensiveScore < 0.2 && score.length >= 10;
}

function moderationSummary(scores: ContentScore[]): Record<ModerationFlag, number> {
  const summary: Record<ModerationFlag, number> = { spam: 0, offensive: 0, misinformation: 0, harassment: 0, clean: 0 };
  scores.forEach((s) => summary[classifyContent(s)]++);
  return summary;
}

describe("User content moderation", () => {
  it("classifyContent: high spam → spam", () => {
    const s: ContentScore = { text: "buy now!", spamScore: 0.9, offensiveScore: 0.1, length: 8 };
    expect(classifyContent(s)).toBe("spam");
  });

  it("classifyContent: high offensive → offensive", () => {
    const s: ContentScore = { text: "bad content", spamScore: 0.1, offensiveScore: 0.8, length: 11 };
    expect(classifyContent(s)).toBe("offensive");
  });

  it("classifyContent: low scores → clean", () => {
    const s: ContentScore = { text: "great space!", spamScore: 0.1, offensiveScore: 0.1, length: 12 };
    expect(classifyContent(s)).toBe("clean");
  });

  it("requiresReview: spam above 0.5", () => {
    const s: ContentScore = { text: "x", spamScore: 0.6, offensiveScore: 0.1, length: 1 };
    expect(requiresReview(s)).toBe(true);
  });

  it("requiresReview: both low → false", () => {
    const s: ContentScore = { text: "nice", spamScore: 0.1, offensiveScore: 0.1, length: 4 };
    expect(requiresReview(s)).toBe(false);
  });

  it("isAutoApproved: low scores and sufficient length → true", () => {
    const s: ContentScore = { text: "Great coworking space", spamScore: 0.05, offensiveScore: 0.05, length: 21 };
    expect(isAutoApproved(s)).toBe(true);
  });

  it("isAutoApproved: too short → false", () => {
    const s: ContentScore = { text: "ok", spamScore: 0.05, offensiveScore: 0.05, length: 2 };
    expect(isAutoApproved(s)).toBe(false);
  });

  it("moderationSummary counts correctly", () => {
    const scores: ContentScore[] = [
      { text: "a", spamScore: 0.9, offensiveScore: 0.0, length: 1 },
      { text: "b", spamScore: 0.1, offensiveScore: 0.1, length: 1 },
    ];
    const summary = moderationSummary(scores);
    expect(summary.spam).toBe(1);
    expect(summary.clean).toBe(1);
  });
});
