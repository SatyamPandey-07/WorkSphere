/**
 * Tests for venue reward campaign targeting and eligibility.
 */

interface RewardCampaign {
  campaignId: string;
  venueId: string;
  rewardPoints: number;
  minBookingCents: number;
  maxRedemptions: number;
  currentRedemptions: number;
  startMs: number;
  endMs: number;
  targetUserIds?: string[]; // undefined = all users
}

function isCampaignEligible(
  campaign: RewardCampaign,
  userId: string,
  bookingCents: number,
  nowMs: number
): boolean {
  if (nowMs < campaign.startMs || nowMs >= campaign.endMs) return false;
  if (campaign.currentRedemptions >= campaign.maxRedemptions) return false;
  if (bookingCents < campaign.minBookingCents) return false;
  if (campaign.targetUserIds && !campaign.targetUserIds.includes(userId)) return false;
  return true;
}

function redeemCampaign(campaign: RewardCampaign): RewardCampaign {
  if (campaign.currentRedemptions >= campaign.maxRedemptions) {
    throw new Error("Campaign redemption limit reached");
  }
  return { ...campaign, currentRedemptions: campaign.currentRedemptions + 1 };
}

function remainingRedemptions(campaign: RewardCampaign): number {
  return Math.max(0, campaign.maxRedemptions - campaign.currentRedemptions);
}

const NOW = 1_700_000_000_000;
const CAMPAIGN: RewardCampaign = {
  campaignId: "c1", venueId: "v1",
  rewardPoints: 100, minBookingCents: 2000,
  maxRedemptions: 50, currentRedemptions: 10,
  startMs: NOW - 86_400_000, endMs: NOW + 86_400_000,
};

describe("Venue reward campaign", () => {
  it("eligible: all conditions met → true", () => {
    expect(isCampaignEligible(CAMPAIGN, "u1", 3000, NOW)).toBe(true);
  });

  it("not eligible: before start", () => {
    expect(isCampaignEligible(CAMPAIGN, "u1", 3000, CAMPAIGN.startMs - 1)).toBe(false);
  });

  it("not eligible: after end", () => {
    expect(isCampaignEligible(CAMPAIGN, "u1", 3000, CAMPAIGN.endMs)).toBe(false);
  });

  it("not eligible: max redemptions reached", () => {
    expect(isCampaignEligible({ ...CAMPAIGN, currentRedemptions: 50 }, "u1", 3000, NOW)).toBe(false);
  });

  it("not eligible: booking below minimum", () => {
    expect(isCampaignEligible(CAMPAIGN, "u1", 1000, NOW)).toBe(false);
  });

  it("not eligible: user not in target list", () => {
    const targeted = { ...CAMPAIGN, targetUserIds: ["u2", "u3"] };
    expect(isCampaignEligible(targeted, "u1", 3000, NOW)).toBe(false);
  });

  it("eligible: user in target list", () => {
    const targeted = { ...CAMPAIGN, targetUserIds: ["u1", "u2"] };
    expect(isCampaignEligible(targeted, "u1", 3000, NOW)).toBe(true);
  });

  it("redeemCampaign: increments redemptions", () => {
    const redeemed = redeemCampaign(CAMPAIGN);
    expect(redeemed.currentRedemptions).toBe(11);
  });

  it("redeemCampaign: throws at limit", () => {
    const maxed = { ...CAMPAIGN, currentRedemptions: 50 };
    expect(() => redeemCampaign(maxed)).toThrow("limit reached");
  });

  it("remainingRedemptions: 50 - 10 = 40", () => {
    expect(remainingRedemptions(CAMPAIGN)).toBe(40);
  });
});
