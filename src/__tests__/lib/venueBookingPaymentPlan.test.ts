/**
 * Tests for venue booking installment payment plan management.
 */

interface Installment {
  number: number;
  dueMs: number;
  amount: number;
  paid: boolean;
  paidAt: number | null;
}

interface PaymentPlan {
  bookingId: string;
  totalAmount: number;
  installments: Installment[];
  lateFeePercent: number;
  gracePeriodDays: number;
}

function totalPaid(plan: PaymentPlan): number {
  return Math.round(plan.installments.filter((i) => i.paid).reduce((s, i) => s + i.amount, 0) * 100) / 100;
}

function totalDue(plan: PaymentPlan): number {
  return Math.round((plan.totalAmount - totalPaid(plan)) * 100) / 100;
}

function nextDueInstallment(plan: PaymentPlan): Installment | null {
  return plan.installments.filter((i) => !i.paid).sort((a, b) => a.dueMs - b.dueMs)[0] ?? null;
}

function overdueInstallments(plan: PaymentPlan, nowMs: number): Installment[] {
  const gracePeriodMs = plan.gracePeriodDays * 86_400_000;
  return plan.installments.filter((i) => !i.paid && nowMs > i.dueMs + gracePeriodMs);
}

function lateFee(installment: Installment, plan: PaymentPlan, nowMs: number): number {
  if (installment.paid) return 0;
  const gracePeriodMs = plan.gracePeriodDays * 86_400_000;
  if (nowMs <= installment.dueMs + gracePeriodMs) return 0;
  return Math.round(installment.amount * (plan.lateFeePercent / 100) * 100) / 100;
}

function completionPercent(plan: PaymentPlan): number {
  if (plan.installments.length === 0) return 0;
  const paid = plan.installments.filter((i) => i.paid).length;
  return Math.round((paid / plan.installments.length) * 100);
}

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const PLAN: PaymentPlan = {
  bookingId: "b1", totalAmount: 3000, lateFeePercent: 5, gracePeriodDays: 3,
  installments: [
    { number: 1, dueMs: NOW - 30 * DAY, amount: 1000, paid: true,  paidAt: NOW - 30 * DAY },
    { number: 2, dueMs: NOW - 5  * DAY, amount: 1000, paid: false, paidAt: null },
    { number: 3, dueMs: NOW + 25 * DAY, amount: 1000, paid: false, paidAt: null },
  ],
};

describe("Installment payment plan management", () => {
  it("totalPaid: installment 1 paid = $1000", () => {
    expect(totalPaid(PLAN)).toBe(1000);
  });

  it("totalDue: $3000 - $1000 = $2000", () => {
    expect(totalDue(PLAN)).toBe(2000);
  });

  it("nextDueInstallment: installment 2 (overdue)", () => {
    expect(nextDueInstallment(PLAN)?.number).toBe(2);
  });

  it("overdueInstallments: installment 2 overdue past grace", () => {
    const overdue = overdueInstallments(PLAN, NOW);
    expect(overdue.map((i) => i.number)).toContain(2);
  });

  it("lateFee: installment 2 at 5% = $50", () => {
    expect(lateFee(PLAN.installments[1], PLAN, NOW)).toBe(50);
  });

  it("completionPercent: 1 of 3 = 33%", () => {
    expect(completionPercent(PLAN)).toBe(33);
  });
});
