/**
 * Tests for venue listing promotion and boosted placement.
 */

interface PromotionCampaign {
  venueId: string;
  budget: number;      // total cents
  spent: number;       // cents spent so far
  startMs: number;
  endMs: number;
  dailyCapCents: number;
  spentTodayCents: number;
  isActive: boolean;
}

function isCampaignActive(campaign: PromotionCampaign, nowMs: number): boolean {
  return (
    campaign.isActive &&
    nowMs >= campaign.startMs &&
    nowMs < campaign.endMs &&
    campaign.spent < campaign.budget
  );
}

function canSpend(campaign: PromotionCampaign, amountCents: number): boolean {
  if (!campaign.isActive) return false;
  if (campaign.spent + amountCents > campaign.budget) return false;
  if (campaign.spentTodayCents + amountCents > campaign.dailyCapCents) return false;
  return true;
}

function recordSpend(
  campaign: PromotionCampaign,
  amountCents: number
): PromotionCampaign {
  return {
    ...campaign,
    spent: campaign.spent + amountCents,
    spentTodayCents: campaign.spentTodayCents + amountCents,
  };
}

function remainingBudget(campaign: PromotionCampaign): number {
  return Math.max(0, campaign.budget - campaign.spent);
}

const NOW = 1_700_000_000_000;
const CAMPAIGN: PromotionCampaign = {
  venueId: "v1",
  budget: 50_000, spent: 20_000,
  startMs: NOW - 86_400_000, endMs: NOW + 86_400_000,
  dailyCapCents: 5000, spentTodayCents: 2000,
  isActive: true,
};

describe("Venue listing promotion", () => {
  it("isCampaignActive: within dates and budget → true", () => {
    expect(isCampaignActive(CAMPAIGN, NOW)).toBe(true);
  });

  it("isCampaignActive: budget exhausted → false", () => {
    expect(isCampaignActive({ ...CAMPAIGN, spent: 50_000 }, NOW)).toBe(false);
  });

  it("isCampaignActive: before start → false", () => {
    expect(isCampaignActive(CAMPAIGN, CAMPAIGN.startMs - 1)).toBe(false);
  });

  it("isCampaignActive: after end → false", () => {
    expect(isCampaignActive(CAMPAIGN, CAMPAIGN.endMs)).toBe(false);
  });

  it("canSpend: within budget and daily cap → true", () => {
    expect(canSpend(CAMPAIGN, 1000)).toBe(true);
  });

  it("canSpend: would exceed total budget → false", () => {
    expect(canSpend(CAMPAIGN, 35_000)).toBe(false);
  });

  it("canSpend: would exceed daily cap → false", () => {
    expect(canSpend(CAMPAIGN, 4000)).toBe(false); // 2000 + 4000 > 5000
  });

  it("recordSpend: updates spent and today", () => {
    const updated = recordSpend(CAMPAIGN, 500);
    expect(updated.spent).toBe(20_500);
    expect(updated.spentTodayCents).toBe(2500);
  });

  it("remainingBudget: 50000 - 20000 = 30000", () => {
    expect(remainingBudget(CAMPAIGN)).toBe(30_000);
  });
});
