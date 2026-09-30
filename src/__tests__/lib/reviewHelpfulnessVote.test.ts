/**
 * Tests for review helpfulness voting (up/down votes).
 */

interface ReviewVote {
  reviewId: string;
  userId: string;
  vote: "helpful" | "not_helpful";
  votedAt: number;
}

interface ReviewVoteSummary {
  reviewId: string;
  helpfulVotes: number;
  notHelpfulVotes: number;
  total: number;
  helpfulnessPct: number;
}

function summarizeVotes(
  votes: ReviewVote[],
  reviewId: string
): ReviewVoteSummary {
  const relevant = votes.filter((v) => v.reviewId === reviewId);
  const helpful = relevant.filter((v) => v.vote === "helpful").length;
  const notHelpful = relevant.filter((v) => v.vote === "not_helpful").length;
  const total = relevant.length;
  return {
    reviewId,
    helpfulVotes: helpful,
    notHelpfulVotes: notHelpful,
    total,
    helpfulnessPct: total === 0 ? 0 : Math.round((helpful / total) * 100),
  };
}

function userVote(
  votes: ReviewVote[],
  reviewId: string,
  userId: string
): ReviewVote["vote"] | null {
  return votes.find((v) => v.reviewId === reviewId && v.userId === userId)?.vote ?? null;
}

function castVote(
  votes: ReviewVote[],
  reviewId: string,
  userId: string,
  vote: ReviewVote["vote"],
  nowMs: number
): ReviewVote[] {
  const existing = votes.findIndex((v) => v.reviewId === reviewId && v.userId === userId);
  if (existing !== -1) {
    return votes.map((v, i) => (i === existing ? { ...v, vote, votedAt: nowMs } : v));
  }
  return [...votes, { reviewId, userId, vote, votedAt: nowMs }];
}

const NOW = 1_700_000_000_000;
const VOTES: ReviewVote[] = [
  { reviewId: "r1", userId: "u1", vote: "helpful",     votedAt: NOW - 3000 },
  { reviewId: "r1", userId: "u2", vote: "helpful",     votedAt: NOW - 2000 },
  { reviewId: "r1", userId: "u3", vote: "not_helpful", votedAt: NOW - 1000 },
];

describe("Review helpfulness voting", () => {
  it("summarizeVotes: r1 has 2 helpful, 1 not_helpful", () => {
    const s = summarizeVotes(VOTES, "r1");
    expect(s.helpfulVotes).toBe(2);
    expect(s.notHelpfulVotes).toBe(1);
    expect(s.total).toBe(3);
  });

  it("summarizeVotes: helpfulnessPct = 67% (2/3)", () => {
    const s = summarizeVotes(VOTES, "r1");
    expect(s.helpfulnessPct).toBe(67);
  });

  it("summarizeVotes: unknown review → zeros", () => {
    const s = summarizeVotes(VOTES, "r99");
    expect(s.total).toBe(0);
    expect(s.helpfulnessPct).toBe(0);
  });

  it("userVote: u1 voted helpful", () => {
    expect(userVote(VOTES, "r1", "u1")).toBe("helpful");
  });

  it("userVote: unvoted user → null", () => {
    expect(userVote(VOTES, "r1", "u99")).toBeNull();
  });

  it("castVote: adds new vote", () => {
    const updated = castVote(VOTES, "r1", "u4", "helpful", NOW);
    expect(updated).toHaveLength(4);
  });

  it("castVote: updates existing vote", () => {
    const updated = castVote(VOTES, "r1", "u1", "not_helpful", NOW);
    expect(userVote(updated, "r1", "u1")).toBe("not_helpful");
    expect(updated).toHaveLength(3); // no new entry
  });
});
