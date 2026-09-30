/**
 * Tests for venue booking rate card management.
 */

interface RateCard {
  rateCardId: string;
  venueId: string;
  name: string;
  rates: {
    seatType: string;
    hourlyRateCents: number;
    halfDayRateCents: number;    // 4h
    fullDayRateCents: number;    // 8h
    weeklyRateCents: number;     // 5 days
    monthlyRateCents: number;    // 20 days
  }[];
  validFrom: string;
  validUntil: string | null;
  currency: string;
}

function effectiveRateCents(
  rateCard: RateCard,
  seatType: string,
  hours: number
): number | null {
  const rate = rateCard.rates.find((r) => r.seatType === seatType);
  if (!rate) return null;

  if (hours >= 160) return rate.monthlyRateCents; // ~20 days
  if (hours >= 40) return Math.round(rate.weeklyRateCents * (hours / 40)); // scale
  if (hours >= 8) return Math.round(rate.fullDayRateCents * (hours / 8));
  if (hours >= 4) return Math.round(rate.halfDayRateCents * (hours / 4));
  return rate.hourlyRateCents * hours;
}

function savings(rateCard: RateCard, seatType: string, hours: number): number {
  const bundled = effectiveRateCents(rateCard, seatType, hours);
  const hourly = rateCard.rates.find((r) => r.seatType === seatType)?.hourlyRateCents ?? 0;
  const hourlyTotal = hourly * hours;
  if (!bundled) return 0;
  return Math.max(0, hourlyTotal - bundled);
}

function isRateCardActive(rateCard: RateCard, dateStr: string): boolean {
  if (dateStr < rateCard.validFrom) return false;
  if (rateCard.validUntil && dateStr > rateCard.validUntil) return false;
  return true;
}

const RATE_CARD: RateCard = {
  rateCardId: "rc1", venueId: "v1", name: "Standard 2026",
  rates: [{
    seatType: "hot_desk",
    hourlyRateCents: 500, halfDayRateCents: 1800,
    fullDayRateCents: 3200, weeklyRateCents: 14000, monthlyRateCents: 45000,
  }],
  validFrom: "2026-01-01", validUntil: "2026-12-31",
  currency: "USD",
};

describe("Venue booking rate card", () => {
  it("effectiveRateCents: 1h = hourly rate × 1", () => {
    expect(effectiveRateCents(RATE_CARD, "hot_desk", 1)).toBe(500);
  });

  it("effectiveRateCents: 4h = half day rate", () => {
    expect(effectiveRateCents(RATE_CARD, "hot_desk", 4)).toBe(1800);
  });

  it("effectiveRateCents: 8h = full day rate", () => {
    expect(effectiveRateCents(RATE_CARD, "hot_desk", 8)).toBe(3200);
  });

  it("effectiveRateCents: unknown seat type → null", () => {
    expect(effectiveRateCents(RATE_CARD, "premium_suite", 4)).toBeNull();
  });

  it("savings: half day saves vs hourly", () => {
    // 4h hourly = 4×500=2000 vs half day 1800 → save 200
    expect(savings(RATE_CARD, "hot_desk", 4)).toBe(200);
  });

  it("savings: 1h = no savings (uses hourly)", () => {
    expect(savings(RATE_CARD, "hot_desk", 1)).toBe(0);
  });

  it("isRateCardActive: 2026-10-01 → true", () => {
    expect(isRateCardActive(RATE_CARD, "2026-10-01")).toBe(true);
  });

  it("isRateCardActive: 2027-01-01 → false (past validity)", () => {
    expect(isRateCardActive(RATE_CARD, "2027-01-01")).toBe(false);
  });
});
