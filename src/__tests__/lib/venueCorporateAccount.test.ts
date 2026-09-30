/**
 * Tests for venue corporate account management and billing.
 */

interface CorporateAccount {
  accountId: string;
  companyName: string;
  billingEmail: string;
  monthlyBudgetCents: number;
  spentThisMonthCents: number;
  seats: number;             // number of employees
  discountPct: number;
  isActive: boolean;
}

function remainingBudget(account: CorporateAccount): number {
  return Math.max(0, account.monthlyBudgetCents - account.spentThisMonthCents);
}

function canMakePurchase(account: CorporateAccount, amountCents: number): boolean {
  if (!account.isActive) return false;
  return remainingBudget(account) >= amountCents;
}

function applyCorporateDiscount(baseCents: number, account: CorporateAccount): number {
  return Math.round(baseCents * (1 - account.discountPct / 100));
}

function budgetUtilizationPercent(account: CorporateAccount): number {
  if (account.monthlyBudgetCents === 0) return 0;
  return Math.round((account.spentThisMonthCents / account.monthlyBudgetCents) * 100);
}

function resetMonthlySpend(account: CorporateAccount): CorporateAccount {
  return { ...account, spentThisMonthCents: 0 };
}

function recordSpend(account: CorporateAccount, amountCents: number): CorporateAccount {
  if (!canMakePurchase(account, amountCents)) throw new Error("Insufficient budget or inactive account");
  return { ...account, spentThisMonthCents: account.spentThisMonthCents + amountCents };
}

const ACCOUNT: CorporateAccount = {
  accountId: "corp1", companyName: "TechCo", billingEmail: "billing@techco.com",
  monthlyBudgetCents: 100_000, spentThisMonthCents: 40_000,
  seats: 20, discountPct: 15, isActive: true,
};

describe("Venue corporate account management", () => {
  it("remainingBudget: 100000 - 40000 = 60000", () => {
    expect(remainingBudget(ACCOUNT)).toBe(60_000);
  });

  it("canMakePurchase: 50000 with 60000 remaining → true", () => {
    expect(canMakePurchase(ACCOUNT, 50_000)).toBe(true);
  });

  it("canMakePurchase: 70000 exceeds remaining → false", () => {
    expect(canMakePurchase(ACCOUNT, 70_000)).toBe(false);
  });

  it("canMakePurchase: inactive account → false", () => {
    expect(canMakePurchase({ ...ACCOUNT, isActive: false }, 1000)).toBe(false);
  });

  it("applyCorporateDiscount: 15% off 10000 = 8500", () => {
    expect(applyCorporateDiscount(10_000, ACCOUNT)).toBe(8_500);
  });

  it("budgetUtilizationPercent: 40000/100000 = 40%", () => {
    expect(budgetUtilizationPercent(ACCOUNT)).toBe(40);
  });

  it("resetMonthlySpend: clears spent", () => {
    expect(resetMonthlySpend(ACCOUNT).spentThisMonthCents).toBe(0);
  });

  it("recordSpend: updates spent", () => {
    const updated = recordSpend(ACCOUNT, 5_000);
    expect(updated.spentThisMonthCents).toBe(45_000);
  });

  it("recordSpend: throws on insufficient budget", () => {
    expect(() => recordSpend(ACCOUNT, 80_000)).toThrow("Insufficient budget");
  });
});
