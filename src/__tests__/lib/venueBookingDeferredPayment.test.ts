/**
 * Tests for venue booking deferred/BNPL payment option management.
 */

interface DeferredPaymentOption {
  provider: string;
  minAmount: number;
  maxAmount: number;
  termMonths: number;
  interestRate: number;   // annual, 0 = interest-free
  processingFeePercent: number;
  availableForTiers: string[];
}

interface DeferredPaymentApplication {
  userId: string;
  bookingId: string;
  amount: number;
  provider: string;
  termMonths: number;
  approvedLimit: number | null;
  status: "pending" | "approved" | "rejected" | "active" | "completed";
}

function monthlyPayment(amount: number, termMonths: number, annualRate: number): number {
  if (annualRate === 0) return Math.round((amount / termMonths) * 100) / 100;
  const monthlyRate = annualRate / 12;
  const payment = (amount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
    (Math.pow(1 + monthlyRate, termMonths) - 1);
  return Math.round(payment * 100) / 100;
}

function totalCost(amount: number, termMonths: number, annualRate: number, feePercent: number): number {
  const fee = Math.round(amount * feePercent * 100) / 100;
  const monthly = monthlyPayment(amount, termMonths, annualRate);
  return Math.round((monthly * termMonths + fee) * 100) / 100;
}

function isEligible(option: DeferredPaymentOption, amount: number, tier: string): boolean {
  return amount >= option.minAmount && amount <= option.maxAmount && option.availableForTiers.includes(tier);
}

function processingFee(option: DeferredPaymentOption, amount: number): number {
  return Math.round(amount * (option.processingFeePercent / 100) * 100) / 100;
}

function interestTotal(amount: number, termMonths: number, annualRate: number): number {
  if (annualRate === 0) return 0;
  return Math.round((totalCost(amount, termMonths, annualRate, 0) - amount) * 100) / 100;
}

const OPTION: DeferredPaymentOption = {
  provider: "PayLater", minAmount: 500, maxAmount: 10000, termMonths: 6,
  interestRate: 0.12, processingFeePercent: 1.5, availableForTiers: ["basic", "premium"],
};

describe("Deferred payment option management", () => {
  it("monthlyPayment: $1200 interest-free over 6 = $200", () => {
    expect(monthlyPayment(1200, 6, 0)).toBe(200);
  });

  it("monthlyPayment: with interest > amount/months", () => {
    expect(monthlyPayment(1200, 6, 0.12)).toBeGreaterThan(200);
  });

  it("isEligible: $1000 for basic tier → true", () => {
    expect(isEligible(OPTION, 1000, "basic")).toBe(true);
  });

  it("isEligible: $100 below minimum → false", () => {
    expect(isEligible(OPTION, 100, "basic")).toBe(false);
  });

  it("processingFee: 1.5% of $1000 = $15", () => {
    expect(processingFee(OPTION, 1000)).toBe(15);
  });

  it("interestTotal: 0% rate → $0 interest", () => {
    expect(interestTotal(1200, 6, 0)).toBe(0);
  });

  it("interestTotal: 12% rate → positive interest", () => {
    expect(interestTotal(1200, 6, 0.12)).toBeGreaterThan(0);
  });
});
