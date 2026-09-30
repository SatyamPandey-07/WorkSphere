/**
 * Tests for venue waitlist priority scoring for premium members.
 */

type MemberTier = "basic" | "silver" | "gold" | "platinum";

interface WaitlistCandidate {
  userId: string;
  tier: MemberTier;
  joinedAt: number;
  isMember: boolean;
}

const TIER_PRIORITY: Record<MemberTier, number> = {
  platinum: 100, gold: 75, silver: 50, basic: 25,
};

const NON_MEMBER_PRIORITY = 10;

function priorityScore(candidate: WaitlistCandidate): number {
  const tierScore = candidate.isMember ? TIER_PRIORITY[candidate.tier] : NON_MEMBER_PRIORITY;
  // Earlier joined = higher score within same tier
  const timeScore = 1 / (candidate.joinedAt / 1_000_000);
  return tierScore + timeScore;
}

function sortWaitlist(candidates: WaitlistCandidate[]): WaitlistCandidate[] {
  return [...candidates].sort((a, b) => priorityScore(b) - priorityScore(a));
}

function topNCandidates(
  candidates: WaitlistCandidate[],
  n: number
): WaitlistCandidate[] {
  return sortWaitlist(candidates).slice(0, n);
}

const NOW = 1_700_000_000_000;
const CANDIDATES: WaitlistCandidate[] = [
  { userId: "u1", tier: "basic",    joinedAt: NOW - 5000, isMember: true  },
  { userId: "u2", tier: "platinum", joinedAt: NOW - 3000, isMember: true  },
  { userId: "u3", tier: "gold",     joinedAt: NOW - 4000, isMember: true  },
  { userId: "u4", tier: "basic",    joinedAt: NOW - 1000, isMember: false }, // non-member
];

describe("Venue waitlist priority", () => {
  it("platinum scores higher than gold", () => {
    expect(priorityScore(CANDIDATES[1])).toBeGreaterThan(priorityScore(CANDIDATES[2]));
  });

  it("non-member scores lower than basic member", () => {
    expect(priorityScore(CANDIDATES[3])).toBeLessThan(priorityScore(CANDIDATES[0]));
  });

  it("sortWaitlist: platinum comes first", () => {
    const sorted = sortWaitlist(CANDIDATES);
    expect(sorted[0].tier).toBe("platinum");
  });

  it("sortWaitlist: non-member last", () => {
    const sorted = sortWaitlist(CANDIDATES);
    expect(sorted[sorted.length - 1].isMember).toBe(false);
  });

  it("topNCandidates: returns at most N", () => {
    expect(topNCandidates(CANDIDATES, 2)).toHaveLength(2);
  });

  it("topNCandidates: N > total → all candidates", () => {
    expect(topNCandidates(CANDIDATES, 10)).toHaveLength(4);
  });

  it("sortWaitlist does not mutate original", () => {
    const original = CANDIDATES.map((c) => c.userId);
    sortWaitlist(CANDIDATES);
    expect(CANDIDATES.map((c) => c.userId)).toEqual(original);
  });
});
