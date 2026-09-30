/**
 * Tests for user referral reward calculation.
 */

interface ReferralReward {
  referrerId: string;
  refereeId: string;
  refereeFirstBookingCents: number;
  rewardPct: number;
  credited: boolean;
}

function calculateReward(
  firstBookingCents: number,
  rewardPct: number
): number {
  return Math.round(firstBookingCents * (rewardPct / 100));
}

function canCreditReward(reward: ReferralReward): boolean {
  return !reward.credited && reward.refereeFirstBookingCents > 0;
}

function totalReferralEarnings(
  rewards: ReferralReward[],
  referrerId: string
): number {
  return rewards
    .filter((r) => r.referrerId === referrerId && r.credited)
    .reduce(
      (sum, r) =>
        sum + calculateReward(r.refereeFirstBookingCents, r.rewardPct),
      0
    );
}

const REWARDS: ReferralReward[] = [
  { referrerId: "u1", refereeId: "u2", refereeFirstBookingCents: 5000, rewardPct: 10, credited: true  },
  { referrerId: "u1", refereeId: "u3", refereeFirstBookingCents: 3000, rewardPct: 10, credited: false },
  { referrerId: "u2", refereeId: "u4", refereeFirstBookingCents: 2000, rewardPct: 10, credited: true  },
];

describe("User referral reward", () => {
  it("calculateReward: 10% of 5000 → 500", () => {
    expect(calculateReward(5000, 10)).toBe(500);
  });

  it("calculateReward: 0% → 0", () => {
    expect(calculateReward(5000, 0)).toBe(0);
  });

  it("calculateReward: 100% → full amount", () => {
    expect(calculateReward(5000, 100)).toBe(5000);
  });

  it("canCreditReward: not yet credited + has booking → true", () => {
    expect(canCreditReward(REWARDS[1])).toBe(true);
  });

  it("canCreditReward: already credited → false", () => {
    expect(canCreditReward(REWARDS[0])).toBe(false);
  });

  it("canCreditReward: zero booking amount → false", () => {
    const r: ReferralReward = { referrerId: "a", refereeId: "b", refereeFirstBookingCents: 0, rewardPct: 10, credited: false };
    expect(canCreditReward(r)).toBe(false);
  });

  it("totalReferralEarnings: u1 credited earnings = 500", () => {
    expect(totalReferralEarnings(REWARDS, "u1")).toBe(500);
  });

  it("totalReferralEarnings: unknown user → 0", () => {
    expect(totalReferralEarnings(REWARDS, "u99")).toBe(0);
  });
});
