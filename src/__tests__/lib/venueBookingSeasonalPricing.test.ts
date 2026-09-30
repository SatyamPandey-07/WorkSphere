/**
 * Tests for venue seasonal pricing rule engine.
 */

type Season = "peak" | "high" | "mid" | "low";

interface SeasonRule {
  season: Season;
  months: number[];
  multiplier: number;
  minAdvanceDays: number;
}

const SEASON_RULES: SeasonRule[] = [
  { season: "peak", months: [11, 12, 1], multiplier: 1.6,  minAdvanceDays: 30 },
  { season: "high", months: [6, 7, 8],  multiplier: 1.3,  minAdvanceDays: 14 },
  { season: "mid",  months: [3, 4, 5],  multiplier: 1.1,  minAdvanceDays: 7  },
  { season: "low",  months: [2, 9, 10], multiplier: 0.85, minAdvanceDays: 0  },
];

function seasonForMonth(month: number): SeasonRule {
  return SEASON_RULES.find((r) => r.months.includes(month)) ?? SEASON_RULES[3];
}

function seasonalPrice(basePrice: number, month: number): number {
  return Math.round(basePrice * seasonForMonth(month).multiplier * 100) / 100;
}

function minAdvanceDays(month: number): number {
  return seasonForMonth(month).minAdvanceDays;
}

function annualPricingCalendar(basePrice: number): { month: number; price: number; season: Season }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const rule = seasonForMonth(m);
    return { month: m, price: seasonalPrice(basePrice, m), season: rule.season };
  });
}

function peakMonthRevenue(basePrice: number, bookingsPerMonth: number[]): number {
  const calendar = annualPricingCalendar(basePrice);
  return Math.round(
    calendar.reduce((s, { month, price }) => s + price * (bookingsPerMonth[month - 1] ?? 0), 0) * 100
  ) / 100;
}

describe("Venue seasonal pricing", () => {
  it("seasonForMonth: December → peak", () => {
    expect(seasonForMonth(12).season).toBe("peak");
  });

  it("seasonForMonth: August → high", () => {
    expect(seasonForMonth(8).season).toBe("high");
  });

  it("seasonalPrice: $1000 base in January = $1600", () => {
    expect(seasonalPrice(1000, 1)).toBe(1600);
  });

  it("seasonalPrice: $1000 base in September = $850", () => {
    expect(seasonalPrice(1000, 9)).toBe(850);
  });

  it("minAdvanceDays: December → 30", () => {
    expect(minAdvanceDays(12)).toBe(30);
  });

  it("annualPricingCalendar: returns 12 months", () => {
    expect(annualPricingCalendar(1000).length).toBe(12);
  });

  it("peakMonthRevenue: higher in peak months", () => {
    const uniform = Array(12).fill(10);
    const revenue = peakMonthRevenue(1000, uniform);
    expect(revenue).toBeGreaterThan(12 * 1000 * 10); // some months above base
  });
});
