/**
 * Tests for recurring membership payment management.
 */

type RecurringInterval = "weekly" | "monthly" | "quarterly" | "annual";

interface RecurringPayment {
  paymentId: string;
  userId: string;
  venueId: string;
  amountCents: number;
  interval: RecurringInterval;
  nextPaymentDate: string;  // YYYY-MM-DD
  status: "active" | "paused" | "cancelled" | "overdue";
  failureCount: number;
  lastProcessedAt: string | null;
}

function nextPaymentDateAfter(date: string, interval: RecurringInterval): string {
  const d = new Date(date);
  switch (interval) {
    case "weekly":    d.setUTCDate(d.getUTCDate() + 7); break;
    case "monthly":   d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "quarterly": d.setUTCMonth(d.getUTCMonth() + 3); break;
    case "annual":    d.setUTCFullYear(d.getUTCFullYear() + 1); break;
  }
  return d.toISOString().split("T")[0];
}

function isPaymentOverdue(payment: RecurringPayment, todayStr: string): boolean {
  return payment.status === "active" && payment.nextPaymentDate < todayStr;
}

function processPayment(payment: RecurringPayment, todayStr: string): RecurringPayment {
  if (payment.status !== "active") throw new Error("Payment not active");
  return {
    ...payment,
    nextPaymentDate: nextPaymentDateAfter(payment.nextPaymentDate, payment.interval),
    lastProcessedAt: todayStr,
    failureCount: 0,
  };
}

function recordFailure(payment: RecurringPayment, maxFailures = 3): RecurringPayment {
  const newCount = payment.failureCount + 1;
  return {
    ...payment,
    failureCount: newCount,
    status: newCount >= maxFailures ? "cancelled" : payment.status,
  };
}

function monthlyEquivalent(payment: RecurringPayment): number {
  const multipliers: Record<RecurringInterval, number> = {
    weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, annual: 1 / 12,
  };
  return Math.round(payment.amountCents * multipliers[payment.interval]);
}

const PAYMENT: RecurringPayment = {
  paymentId: "rp1", userId: "u1", venueId: "v1",
  amountCents: 50_000, interval: "monthly",
  nextPaymentDate: "2026-11-01", status: "active",
  failureCount: 0, lastProcessedAt: "2026-10-01",
};

describe("Recurring membership payment management", () => {
  it("nextPaymentDateAfter: monthly Nov → Dec", () => {
    expect(nextPaymentDateAfter("2026-11-01", "monthly")).toBe("2026-12-01");
  });

  it("nextPaymentDateAfter: annual 2026 → 2027", () => {
    expect(nextPaymentDateAfter("2026-01-01", "annual")).toBe("2027-01-01");
  });

  it("isPaymentOverdue: past due active → true", () => {
    expect(isPaymentOverdue(PAYMENT, "2026-11-15")).toBe(true);
  });

  it("isPaymentOverdue: future due → false", () => {
    expect(isPaymentOverdue(PAYMENT, "2026-10-15")).toBe(false);
  });

  it("processPayment: advances nextPaymentDate", () => {
    const processed = processPayment(PAYMENT, "2026-11-01");
    expect(processed.nextPaymentDate).toBe("2026-12-01");
    expect(processed.lastProcessedAt).toBe("2026-11-01");
  });

  it("processPayment: throws if not active", () => {
    const paused = { ...PAYMENT, status: "paused" as const };
    expect(() => processPayment(paused, "2026-11-01")).toThrow();
  });

  it("recordFailure: 3 failures → cancelled", () => {
    let p = PAYMENT;
    p = recordFailure(p);
    p = recordFailure(p);
    p = recordFailure(p);
    expect(p.status).toBe("cancelled");
  });

  it("monthlyEquivalent: annual 50000 / 12 ≈ 4167", () => {
    const annual = { ...PAYMENT, interval: "annual" as const };
    expect(monthlyEquivalent(annual)).toBeCloseTo(4167, 0);
  });
});
