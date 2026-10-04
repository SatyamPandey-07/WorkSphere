/**
 * Tests for venue booking revenue forecasting and scenario modeling.
 */

interface RevenueScenario {
  name: string;
  avgBookingValue: number;
  bookingsPerMonth: number;
  growthRate: number; // monthly % growth
}

function monthlyRevenue(s: RevenueScenario): number {
  return Math.round(s.avgBookingValue * s.bookingsPerMonth * 100) / 100;
}

function annualRevenue(s: RevenueScenario): number {
  let total = 0;
  let monthly = monthlyRevenue(s);
  for (let m = 0; m < 12; m++) { total += monthly; monthly *= 1 + s.growthRate; }
  return Math.round(total * 100) / 100;
}

function revenueAtMonth(s: RevenueScenario, idx: number): number {
  let monthly = monthlyRevenue(s);
  for (let m = 0; m < idx; m++) monthly *= 1 + s.growthRate;
  return Math.round(monthly * 100) / 100;
}

function breakEvenMonth(s: RevenueScenario, fixedCosts: number): number {
  let cum = 0; let monthly = monthlyRevenue(s);
  for (let m = 0; m < 120; m++) {
    cum += monthly;
    if (cum >= fixedCosts) return m + 1;
    monthly *= 1 + s.growthRate;
  }
  return -1;
}

function scenarioUplift(base: RevenueScenario, opt: RevenueScenario): number {
  return Math.round(((annualRevenue(opt) - annualRevenue(base)) / annualRevenue(base)) * 100);
}

const BASE: RevenueScenario = { name: "Base",      avgBookingValue: 500, bookingsPerMonth: 20, growthRate: 0.02 };
const OPT:  RevenueScenario = { name: "Optimistic",avgBookingValue: 650, bookingsPerMonth: 28, growthRate: 0.05 };

describe("Revenue forecasting", () => {
  it("monthlyRevenue: $500 × 20 = $10000", () => { expect(monthlyRevenue(BASE)).toBe(10000); });
  it("annualRevenue: grows above flat $120k", () => { expect(annualRevenue(BASE)).toBeGreaterThan(120000); });
  it("revenueAtMonth 0 equals monthly", () => { expect(revenueAtMonth(BASE, 0)).toBe(10000); });
  it("revenueAtMonth 6 > month 0", () => { expect(revenueAtMonth(BASE, 6)).toBeGreaterThan(10000); });
  it("breakEvenMonth: $50k on $10k base ≤ 5 months", () => { expect(breakEvenMonth(BASE, 50000)).toBeLessThanOrEqual(5); });
  it("scenarioUplift: optimistic > 0%", () => { expect(scenarioUplift(BASE, OPT)).toBeGreaterThan(0); });
});
