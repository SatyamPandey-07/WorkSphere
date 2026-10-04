/**
 * Tests for venue booking marketing campaign tracking and attribution.
 */

type CampaignChannel = "email" | "social" | "paid_search" | "organic" | "referral" | "affiliate";
type AttributionModel = "first_touch" | "last_touch" | "linear" | "time_decay";

interface CampaignTouchpoint {
  campaignId: string;
  channel: CampaignChannel;
  timestamp: number;
  cost: number;
}

interface ConversionJourney {
  userId: string;
  touchpoints: CampaignTouchpoint[];
  convertedAt: number | null;
  conversionValue: number;
}

function attributeRevenue(journey: ConversionJourney, model: AttributionModel): Record<string, number> {
  if (!journey.convertedAt || journey.touchpoints.length === 0) return {};
  const { touchpoints: tps, conversionValue: value } = journey;
  const result: Record<string, number> = {};

  switch (model) {
    case "first_touch": {
      const first = tps[0];
      result[first.campaignId] = value;
      break;
    }
    case "last_touch": {
      const last = tps[tps.length - 1];
      result[last.campaignId] = value;
      break;
    }
    case "linear": {
      const share = Math.round(value / tps.length * 100) / 100;
      for (const tp of tps) result[tp.campaignId] = (result[tp.campaignId] ?? 0) + share;
      break;
    }
    case "time_decay": {
      // More recent = more credit
      const weights = tps.map((tp, i) => Math.pow(2, i));
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      tps.forEach((tp, i) => {
        result[tp.campaignId] = Math.round(((weights[i] / totalWeight) * value) * 100) / 100;
      });
      break;
    }
  }
  return result;
}

function campaignROI(campaignId: string, journeys: ConversionJourney[], totalCost: number): number {
  const totalRevenue = journeys
    .flatMap((j) => j.touchpoints.filter((t) => t.campaignId === campaignId))
    .length > 0
    ? journeys.filter((j) => j.touchpoints.some((t) => t.campaignId === campaignId) && j.convertedAt)
        .reduce((s, j) => s + j.conversionValue, 0)
    : 0;
  if (totalCost === 0) return 0;
  return Math.round(((totalRevenue - totalCost) / totalCost) * 100);
}

function touchpointCount(journeys: ConversionJourney[], campaignId: string): number {
  return journeys.flatMap((j) => j.touchpoints).filter((t) => t.campaignId === campaignId).length;
}

const NOW = 1_700_000_000_000;
const JOURNEY: ConversionJourney = {
  userId: "u1", conversionValue: 1000, convertedAt: NOW,
  touchpoints: [
    { campaignId: "c1", channel: "email",       timestamp: NOW - 3 * 86_400_000, cost: 50 },
    { campaignId: "c2", channel: "paid_search", timestamp: NOW - 86_400_000,     cost: 100 },
    { campaignId: "c1", channel: "email",       timestamp: NOW - 3600_000,       cost: 50 },
  ],
};

describe("Campaign tracking and attribution", () => {
  it("first_touch: all credit to c1 (first email)", () => {
    const attr = attributeRevenue(JOURNEY, "first_touch");
    expect(attr.c1).toBe(1000);
    expect(attr.c2).toBeUndefined();
  });

  it("last_touch: all credit to c1 (last email)", () => {
    const attr = attributeRevenue(JOURNEY, "last_touch");
    expect(attr.c1).toBe(1000);
  });

  it("linear: split equally 3 touchpoints → ~$333 each", () => {
    const attr = attributeRevenue(JOURNEY, "linear");
    expect(attr.c2).toBeCloseTo(333, 0);
  });

  it("time_decay: last touchpoint gets most credit", () => {
    const attr = attributeRevenue(JOURNEY, "time_decay");
    const lastCampaign = JOURNEY.touchpoints[JOURNEY.touchpoints.length - 1].campaignId;
    const lastCredit = attr[lastCampaign];
    expect(lastCredit).toBeGreaterThan((Object.values(attr)[0] ?? 0));
  });

  it("touchpointCount: c1 appears 2 times", () => {
    expect(touchpointCount([JOURNEY], "c1")).toBe(2);
  });
});
