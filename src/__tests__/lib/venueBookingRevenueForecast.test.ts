/**
 * Tests for venue booking revenue forecasting and scenario modeling.
 */

interface RevenueScenario {
  name: string;
  occupancyRate: number;    // 0-1
  avgBookingValue: number;
  bookingsPerMonth: number;
  growthRate: number;       // monthly % growth, e.g. 0.05 = 5%
}

function monthlyRevenue(scenario: RevenueScenario): number {
  return Math.round(scenario.avgBookingValue * scenario.bookingsPerMonth * 100) / 100;
}

function annualRevenue(scenario: RevenueScenario): number {
  let total = 0;
  let monthly = monthlyRevenue(scenario);
  for (let m = 0; m < 12; m++) {
    total += monthly;
    monthly *= 1 + scenario.growthRate;
  }
  return Math.round(total * 100) / 100;
}

function revenueAtMonth(scenario: RevenueScenario, monthIndex: number): number {
  let monthly = monthlyRevenue(scenario);
  for (let m = 0; m < monthIndex; m++) {
    monthly *= 1 + scenario.growthRate;
  }
  return Math.round(monthly * 100) / 100;
}

function breakEvenMonth(scenario: RevenueScenario, fixedCosts: number): number {
  let cumulative = 0;
  let monthly = monthlyRevenue(scenario);
  for (let m = 0; m < 120; m++) {
    cumulative += monthly;
    if (cumulative >= fixedCosts) return m + 1;
    monthly *= 1 + scenario.growthRate;
  }
  return -1; // never breaks even in 10 years
}

function compareScenarios(
  base: RevenueScenario,
  optimistic: RevenueScenario
): { upliftPercent: number; upliftAmount: number } {
  const baseAnnual = annualRevenue(base);
  const optimisticAnnual = annualRevenue(optimistic);
  return {
    upliftAmount: Math.round((optimisticAnnual - baseAnnual) * 100) / 100,
    upliftPercent: Math.round(((optimisticAnnual - baseAnnual) / baseAnnual) * 100),
  };
}

const BASE: RevenueScenario = {
  name: "Base case", occupancyRate: 0.6, avgBookingValue: 500,
  bookingsPerMonth: 20, growthRate: 0.02,
};
const OPTIMISTIC: RevenueScenario = {
  name: "Optimistic", occupancyRate: 0.8, avgBookingValue: 650,
  bookingsPerMonth: 28, growthRate: 0.05,
};

describe("Revenue forecasting and scenario modeling", () => {
  it("monthlyRevenue: base = $10000/month", () => {
    expect(monthlyRevenue(BASE)).toBe(10000);
  });

  it("annualRevenue: base grows over 12 months", () => {
    expect(annualRevenue(BASE)).toBeGreaterThan(12 * 10000); // growth means > flat
  });

  it("revenueAtMonth: month 0 = same as monthly", () => {
    expect(revenueAtMonth(BASE, 0)).toBe(monthlyRevenue(BASE));
  });

  it("revenueAtMonth: month 6 > month 0 due to growth", () => {
    expect(revenueAtMonth(BASE, 6)).toBeGreaterThan(revenueAtMonth(BASE, 0));
  });

  it("breakEvenMonth: $50k fixed costs on $10k/month base", () => {
    const bm = breakEvenMonth(BASE, 50_000);
    expect(bm).toBeGreaterThan(0);
    expect(bm).toBeLessThanOrEqual(6);
  });

  it("compareScenarios: optimistic has positive uplift", () => {
    const comparison = compareScenarios(BASE, OPTIMISTIC);
    expect(comparison.upliftPercent).toBeGreaterThan(0);
  });
});
