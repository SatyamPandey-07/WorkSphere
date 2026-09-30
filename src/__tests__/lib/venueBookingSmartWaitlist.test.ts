/**
 * Tests for AI-powered smart waitlist prioritization.
 */

interface WaitlistCandidate {
  userId: string;
  joinedAt: number;
  memberTier: "basic" | "silver" | "gold" | "platinum";
  bookingFrequency: number;  // avg bookings/month
  cancellationRate: number;  // 0-1
  responseTimeMs: number;    // avg time to respond to offers
}

function reliabilityScore(candidate: WaitlistCandidate): number {
  // Low cancellation rate + fast response = reliable
  const cancelScore = 1 - candidate.cancellationRate;
  const responseScore = Math.max(0, 1 - candidate.responseTimeMs / (24 * 3600_000));
  return Math.round((cancelScore * 0.6 + responseScore * 0.4) * 100);
}

function priorityScore(candidate: WaitlistCandidate, nowMs: number): number {
  const waitHours = (nowMs - candidate.joinedAt) / 3_600_000;
  const tierBonus = { basic: 0, silver: 10, gold: 20, platinum: 35 }[candidate.memberTier];
  const frequencyBonus = Math.min(candidate.bookingFrequency * 3, 20);
  const reliability = reliabilityScore(candidate);
  const waitBonus = Math.min(waitHours * 0.5, 25);

  return Math.round(reliability + tierBonus + frequencyBonus + waitBonus);
}

function smartWaitlistOrder(candidates: WaitlistCandidate[], nowMs: number): WaitlistCandidate[] {
  return [...candidates].sort((a, b) => priorityScore(b, nowMs) - priorityScore(a, nowMs));
}

function shouldOfferSlot(candidate: WaitlistCandidate): boolean {
  return candidate.cancellationRate < 0.3 && candidate.responseTimeMs < 2 * 3600_000;
}

const NOW = 1_700_000_000_000;
const CANDIDATES: WaitlistCandidate[] = [
  { userId: "u1", joinedAt: NOW - 3 * 3600_000, memberTier: "gold",    bookingFrequency: 4, cancellationRate: 0.05, responseTimeMs: 30 * 60_000  },
  { userId: "u2", joinedAt: NOW - 5 * 3600_000, memberTier: "basic",   bookingFrequency: 1, cancellationRate: 0.3,  responseTimeMs: 6 * 3600_000  },
  { userId: "u3", joinedAt: NOW - 1 * 3600_000, memberTier: "platinum",bookingFrequency: 8, cancellationRate: 0.02, responseTimeMs: 15 * 60_000  },
];

describe("Smart waitlist prioritization", () => {
  it("reliabilityScore: u1 (5% cancel, fast response) → high score", () => {
    expect(reliabilityScore(CANDIDATES[0])).toBeGreaterThan(reliabilityScore(CANDIDATES[1]));
  });

  it("priorityScore: u3 (platinum + reliable) scores highest", () => {
    const s3 = priorityScore(CANDIDATES[2], NOW);
    const s1 = priorityScore(CANDIDATES[0], NOW);
    const s2 = priorityScore(CANDIDATES[1], NOW);
    expect(s3).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });

  it("smartWaitlistOrder: u3 first despite joining last", () => {
    const ordered = smartWaitlistOrder(CANDIDATES, NOW);
    expect(ordered[0].userId).toBe("u3");
  });

  it("shouldOfferSlot: u1 (5% cancel, 30min response) → true", () => {
    expect(shouldOfferSlot(CANDIDATES[0])).toBe(true);
  });

  it("shouldOfferSlot: u2 (30% cancel) → false", () => {
    expect(shouldOfferSlot(CANDIDATES[1])).toBe(false);
  });
});
