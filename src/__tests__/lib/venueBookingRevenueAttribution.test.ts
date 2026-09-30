/**
 * Tests for revenue attribution across booking channels.
 */

type AttributionChannel = "direct" | "google_ads" | "social" | "referral" | "organic" | "email";

interface RevenueAttributionRecord {
  bookingId: string;
  totalCents: number;
  touchpoints: {
    channel: AttributionChannel;
    touchedAt: number;
    isFinalTouch: boolean;
  }[];
}

type AttributionModel = "last_touch" | "first_touch" | "linear" | "time_decay";

function attributeRevenue(
  record: RevenueAttributionRecord,
  model: AttributionModel
): Record<AttributionChannel, number> {
  const result: Record<AttributionChannel, number> = {} as Record<AttributionChannel, number>;
  const touchpoints = record.touchpoints;

  if (touchpoints.length === 0) return result;

  switch (model) {
    case "last_touch": {
      const last = touchpoints.reduce((latest, t) => t.touchedAt > latest.touchedAt ? t : latest);
      result[last.channel] = record.totalCents;
      break;
    }
    case "first_touch": {
      const first = touchpoints.reduce((earliest, t) => t.touchedAt < earliest.touchedAt ? t : earliest);
      result[first.channel] = record.totalCents;
      break;
    }
    case "linear": {
      const perTouch = Math.round(record.totalCents / touchpoints.length);
      touchpoints.forEach((t) => {
        result[t.channel] = (result[t.channel] ?? 0) + perTouch;
      });
      break;
    }
  }

  return result;
}

function channelTotalRevenue(
  records: RevenueAttributionRecord[],
  channel: AttributionChannel,
  model: AttributionModel
): number {
  return records.reduce((sum, record) => {
    const attribution = attributeRevenue(record, model);
    return sum + (attribution[channel] ?? 0);
  }, 0);
}

const NOW = 1_700_000_000_000;
const RECORD: RevenueAttributionRecord = {
  bookingId: "b1",
  totalCents: 3000,
  touchpoints: [
    { channel: "google_ads", touchedAt: NOW - 7 * 86_400_000, isFinalTouch: false },
    { channel: "email",      touchedAt: NOW - 2 * 86_400_000, isFinalTouch: false },
    { channel: "direct",     touchedAt: NOW,                  isFinalTouch: true  },
  ],
};

describe("Revenue attribution models", () => {
  it("last_touch: all credit to direct (last touch)", () => {
    const attr = attributeRevenue(RECORD, "last_touch");
    expect(attr.direct).toBe(3000);
    expect(attr.google_ads).toBeUndefined();
  });

  it("first_touch: all credit to google_ads (first touch)", () => {
    const attr = attributeRevenue(RECORD, "first_touch");
    expect(attr.google_ads).toBe(3000);
    expect(attr.direct).toBeUndefined();
  });

  it("linear: equal credit to all 3 channels", () => {
    const attr = attributeRevenue(RECORD, "linear");
    expect(attr.google_ads).toBe(1000);
    expect(attr.email).toBe(1000);
    expect(attr.direct).toBe(1000);
  });

  it("channelTotalRevenue: direct last_touch = 3000", () => {
    expect(channelTotalRevenue([RECORD], "direct", "last_touch")).toBe(3000);
  });

  it("channelTotalRevenue: social = 0 (not in touchpoints)", () => {
    expect(channelTotalRevenue([RECORD], "social", "last_touch")).toBe(0);
  });
});
