/**
 * Tests for venue event budget management and cost breakdown.
 */

type BudgetCategory = "venue" | "catering" | "av_equipment" | "decoration" | "staffing" | "marketing" | "contingency";

interface BudgetItem {
  category: BudgetCategory;
  estimated: number;
  actual: number | null;
  committed: boolean;
}

interface EventBudget {
  eventId: string;
  totalBudget: number;
  items: BudgetItem[];
  currency: string;
}

function totalEstimated(budget: EventBudget): number {
  return Math.round(budget.items.reduce((s, i) => s + i.estimated, 0) * 100) / 100;
}

function totalActual(budget: EventBudget): number {
  return Math.round(
    budget.items.filter((i) => i.actual !== null).reduce((s, i) => s + i.actual!, 0) * 100
  ) / 100;
}

function budgetVariance(budget: EventBudget): number {
  return Math.round((budget.totalBudget - totalEstimated(budget)) * 100) / 100;
}

function isOverBudget(budget: EventBudget): boolean {
  return totalEstimated(budget) > budget.totalBudget;
}

function uncommittedBudget(budget: EventBudget): number {
  return Math.round(
    budget.items.filter((i) => !i.committed).reduce((s, i) => s + i.estimated, 0) * 100
  ) / 100;
}

function categoryBreakdown(budget: EventBudget): Record<BudgetCategory, number> {
  const result: Partial<Record<BudgetCategory, number>> = {};
  for (const item of budget.items) {
    result[item.category] = Math.round(((result[item.category] ?? 0) + item.estimated) * 100) / 100;
  }
  return result as Record<BudgetCategory, number>;
}

function savingsVsEstimate(budget: EventBudget): number {
  return Math.round((totalEstimated(budget) - totalActual(budget)) * 100) / 100;
}

const BUDGET: EventBudget = {
  eventId: "e1", totalBudget: 15_000, currency: "USD",
  items: [
    { category: "venue",      estimated: 5000, actual: 4800, committed: true },
    { category: "catering",   estimated: 4000, actual: null, committed: true },
    { category: "av_equipment",estimated: 1500, actual: 1500, committed: true },
    { category: "decoration", estimated: 1000, actual: null, committed: false },
    { category: "staffing",   estimated: 2000, actual: null, committed: false },
    { category: "contingency",estimated: 1000, actual: null, committed: false },
  ],
};

describe("Event budget management", () => {
  it("totalEstimated: $14500", () => {
    expect(totalEstimated(BUDGET)).toBe(14500);
  });

  it("totalActual: $6300 (items with actual values)", () => {
    expect(totalActual(BUDGET)).toBe(6300);
  });

  it("budgetVariance: $15000 - $14500 = $500", () => {
    expect(budgetVariance(BUDGET)).toBe(500);
  });

  it("isOverBudget: $14500 < $15000 → false", () => {
    expect(isOverBudget(BUDGET)).toBe(false);
  });

  it("uncommittedBudget: decoration + staffing + contingency = $4000", () => {
    expect(uncommittedBudget(BUDGET)).toBe(4000);
  });

  it("categoryBreakdown: venue = 5000", () => {
    expect(categoryBreakdown(BUDGET).venue).toBe(5000);
  });
});
