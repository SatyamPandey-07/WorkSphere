/**
 * Tests for booking installment payment plan management.
 */

interface PaymentPlan {
  planId: string;
  bookingId: string;
  totalCents: number;
  installments: number;
  installmentCents: number; // per installment (total / installments, rounded)
  nextPaymentDate: string;
  paidInstallments: number;
  currency: string;
}

function createPaymentPlan(
  bookingId: string,
  totalCents: number,
  installments: number,
  firstPaymentDate: string,
  currency = "USD"
): PaymentPlan {
  return {
    planId: `plan-${bookingId}`,
    bookingId,
    totalCents,
    installments,
    installmentCents: Math.ceil(totalCents / installments),
    nextPaymentDate: firstPaymentDate,
    paidInstallments: 0,
    currency,
  };
}

function isFullyPaid(plan: PaymentPlan): boolean {
  return plan.paidInstallments >= plan.installments;
}

function remainingBalance(plan: PaymentPlan): number {
  return Math.max(0, plan.totalCents - plan.paidInstallments * plan.installmentCents);
}

function processInstallment(
  plan: PaymentPlan,
  nextDateStr: string
): PaymentPlan {
  if (isFullyPaid(plan)) throw new Error("Plan already fully paid");
  return {
    ...plan,
    paidInstallments: plan.paidInstallments + 1,
    nextPaymentDate: nextDateStr,
  };
}

const PLAN: PaymentPlan = {
  planId: "plan-b1", bookingId: "b1",
  totalCents: 9000, installments: 3, installmentCents: 3000,
  nextPaymentDate: "2026-10-01", paidInstallments: 0, currency: "USD",
};

describe("Booking payment plan", () => {
  it("createPaymentPlan: 9000 / 3 = 3000 per installment", () => {
    const plan = createPaymentPlan("b1", 9000, 3, "2026-10-01");
    expect(plan.installmentCents).toBe(3000);
  });

  it("createPaymentPlan: ceiling for non-divisible", () => {
    const plan = createPaymentPlan("b2", 1000, 3, "2026-10-01");
    expect(plan.installmentCents).toBe(334); // ceil(1000/3)
  });

  it("isFullyPaid: 0 paid → false", () => {
    expect(isFullyPaid(PLAN)).toBe(false);
  });

  it("isFullyPaid: all paid → true", () => {
    expect(isFullyPaid({ ...PLAN, paidInstallments: 3 })).toBe(true);
  });

  it("remainingBalance: 0 paid = 9000", () => {
    expect(remainingBalance(PLAN)).toBe(9000);
  });

  it("remainingBalance: 1 paid = 6000", () => {
    expect(remainingBalance({ ...PLAN, paidInstallments: 1 })).toBe(6000);
  });

  it("processInstallment: increments paidInstallments", () => {
    const updated = processInstallment(PLAN, "2026-11-01");
    expect(updated.paidInstallments).toBe(1);
    expect(updated.nextPaymentDate).toBe("2026-11-01");
  });

  it("processInstallment: throws when fully paid", () => {
    const paid = { ...PLAN, paidInstallments: 3 };
    expect(() => processInstallment(paid, "2026-12-01")).toThrow("fully paid");
  });
});
