/**
 * Tests for corporate account and bulk booking management.
 */

interface CorporateAccount {
  id: string;
  companyName: string;
  tier: "standard" | "preferred" | "premium";
  monthlyBudget: number;
  spentThisMonth: number;
  approvalRequired: boolean;
  approvalThreshold: number;
  employeeCount: number;
}

interface CorporateBookingRequest {
  accountId: string;
  requester: string;
  amount: number;
  purpose: string;
  attendees: number;
}

function budgetRemaining(account: CorporateAccount): number {
  return Math.max(0, account.monthlyBudget - account.spentThisMonth);
}

function budgetUtilisation(account: CorporateAccount): number {
  if (account.monthlyBudget === 0) return 0;
  return Math.round((account.spentThisMonth / account.monthlyBudget) * 100);
}

function requiresApproval(account: CorporateAccount, request: CorporateBookingRequest): boolean {
  return account.approvalRequired && request.amount >= account.approvalThreshold;
}

function canAuthoriseBooking(account: CorporateAccount, request: CorporateBookingRequest): boolean {
  return request.amount <= budgetRemaining(account);
}

function corporateDiscount(account: CorporateAccount): number {
  const tierDiscount: Record<CorporateAccount["tier"], number> = {
    standard: 0.05, preferred: 0.12, premium: 0.2,
  };
  return tierDiscount[account.tier];
}

function discountedAmount(account: CorporateAccount, amount: number): number {
  return Math.round(amount * (1 - corporateDiscount(account)) * 100) / 100;
}

const ACCOUNT: CorporateAccount = {
  id: "corp-1", companyName: "Acme Corp", tier: "preferred",
  monthlyBudget: 10_000, spentThisMonth: 7500,
  approvalRequired: true, approvalThreshold: 1000, employeeCount: 200,
};

const REQUEST: CorporateBookingRequest = {
  accountId: "corp-1", requester: "alice", amount: 1500,
  purpose: "Team offsite", attendees: 30,
};

describe("Corporate account booking management", () => {
  it("budgetRemaining: $2500 remaining", () => {
    expect(budgetRemaining(ACCOUNT)).toBe(2500);
  });

  it("budgetUtilisation: 75%", () => {
    expect(budgetUtilisation(ACCOUNT)).toBe(75);
  });

  it("requiresApproval: $1500 exceeds $1000 threshold → true", () => {
    expect(requiresApproval(ACCOUNT, REQUEST)).toBe(true);
  });

  it("canAuthoriseBooking: $1500 within $2500 remaining", () => {
    expect(canAuthoriseBooking(ACCOUNT, REQUEST)).toBe(true);
  });

  it("canAuthoriseBooking: exceeds remaining budget → false", () => {
    const bigRequest = { ...REQUEST, amount: 3000 };
    expect(canAuthoriseBooking(ACCOUNT, bigRequest)).toBe(false);
  });

  it("corporateDiscount: preferred = 12%", () => {
    expect(corporateDiscount(ACCOUNT)).toBe(0.12);
  });

  it("discountedAmount: $1500 at 12% = $1320", () => {
    expect(discountedAmount(ACCOUNT, 1500)).toBe(1320);
  });
});
