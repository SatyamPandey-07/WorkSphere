/**
 * Tests for venue booking referral program tracking.
 */

interface Referral {
  referrerId: string;
  refereeId: string;
  code: string;
  createdAt: number;
  firstBookingAt: number | null;
  rewardClaimed: boolean;
  rewardAmount: number;
}

interface ReferralConfig {
  rewardPerReferral: number;
  maxRewardsPerUser: number;
  expiryDays: number;
  minBookingValue: number;
}

const DEFAULT_CONFIG: ReferralConfig = {
  rewardPerReferral: 25,
  maxRewardsPerUser: 10,
  expiryDays: 30,
  minBookingValue: 100,
};

function isReferralExpired(referral: Referral, nowMs: number, config: ReferralConfig): boolean {
  return !referral.firstBookingAt &&
    nowMs - referral.createdAt > config.expiryDays * 86_400_000;
}

function pendingReferrals(referrals: Referral[], referrerId: string): Referral[] {
  return referrals.filter(
    (r) => r.referrerId === referrerId && r.firstBookingAt && !r.rewardClaimed
  );
}

function totalRewardEarned(referrals: Referral[], referrerId: string): number {
  return Math.round(
    referrals
      .filter((r) => r.referrerId === referrerId && r.rewardClaimed)
      .reduce((s, r) => s + r.rewardAmount, 0) * 100
  ) / 100;
}

function canClaimReward(
  referrals: Referral[],
  referrerId: string,
  config: ReferralConfig
): boolean {
  const claimed = referrals.filter((r) => r.referrerId === referrerId && r.rewardClaimed).length;
  return claimed < config.maxRewardsPerUser;
}

function conversionRate(referrals: Referral[]): number {
  if (referrals.length === 0) return 0;
  const converted = referrals.filter((r) => r.firstBookingAt !== null).length;
  return Math.round((converted / referrals.length) * 100);
}

const NOW = 1_700_000_000_000;
const REFERRALS: Referral[] = [
  { referrerId: "u1", refereeId: "u2", code: "REF001", createdAt: NOW - 5 * 86_400_000, firstBookingAt: NOW - 2 * 86_400_000, rewardClaimed: true,  rewardAmount: 25 },
  { referrerId: "u1", refereeId: "u3", code: "REF002", createdAt: NOW - 3 * 86_400_000, firstBookingAt: NOW - 86_400_000,     rewardClaimed: false, rewardAmount: 25 },
  { referrerId: "u1", refereeId: "u4", code: "REF003", createdAt: NOW - 35 * 86_400_000,firstBookingAt: null,                 rewardClaimed: false, rewardAmount: 0 },
];

describe("Referral program tracking", () => {
  it("isReferralExpired: REF003 (35 days old, no booking) → true", () => {
    expect(isReferralExpired(REFERRALS[2], NOW, DEFAULT_CONFIG)).toBe(true);
  });

  it("isReferralExpired: REF001 (booked) → false", () => {
    expect(isReferralExpired(REFERRALS[0], NOW, DEFAULT_CONFIG)).toBe(false);
  });

  it("pendingReferrals: 1 pending for u1", () => {
    expect(pendingReferrals(REFERRALS, "u1").length).toBe(1);
  });

  it("totalRewardEarned: u1 earned $25", () => {
    expect(totalRewardEarned(REFERRALS, "u1")).toBe(25);
  });

  it("canClaimReward: u1 has 1 claim, under max", () => {
    expect(canClaimReward(REFERRALS, "u1", DEFAULT_CONFIG)).toBe(true);
  });

  it("conversionRate: 2 of 3 converted = 67%", () => {
    expect(conversionRate(REFERRALS)).toBe(67);
  });
});
