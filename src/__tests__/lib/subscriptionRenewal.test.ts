/**
 * Tests for subscription renewal and billing cycle management.
 */

type BillingCycle = "monthly" | "quarterly" | "annual";

interface Subscription {
  id: string;
  userId: string;
  plan: string;
  billingCycle: BillingCycle;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  price: number; // cents per billing cycle
}

function nextRenewalMs(sub: Subscription): number {
  return sub.currentPeriodEnd;
}

function isExpired(sub: Subscription, nowMs: number): boolean {
  return nowMs > sub.currentPeriodEnd && !sub.cancelAtPeriodEnd;
}

function daysUntilRenewal(sub: Subscription, nowMs: number): number {
  return Math.max(0, Math.ceil((sub.currentPeriodEnd - nowMs) / 86_400_000));
}

function renewSubscription(sub: Subscription): Subscription {
  const durations: Record<BillingCycle, number> = {
    monthly: 30 * 86_400_000,
    quarterly: 90 * 86_400_000,
    annual: 365 * 86_400_000,
  };
  const duration = durations[sub.billingCycle];
  return {
    ...sub,
    currentPeriodStart: sub.currentPeriodEnd,
    currentPeriodEnd: sub.currentPeriodEnd + duration,
    cancelAtPeriodEnd: false,
  };
}

function cancelAtEnd(sub: Subscription): Subscription {
  return { ...sub, cancelAtPeriodEnd: true };
}

const NOW = 1_700_000_000_000;
const ACTIVE_SUB: Subscription = {
  id: "s1", userId: "u1", plan: "pro", billingCycle: "monthly",
  currentPeriodStart: NOW - 10 * 86_400_000, currentPeriodEnd: NOW + 20 * 86_400_000,
  cancelAtPeriodEnd: false, price: 2999,
};

describe("Subscription renewal", () => {
  it("nextRenewalMs returns currentPeriodEnd", () => {
    expect(nextRenewalMs(ACTIVE_SUB)).toBe(ACTIVE_SUB.currentPeriodEnd);
  });

  it("isExpired: active sub → false", () => {
    expect(isExpired(ACTIVE_SUB, NOW)).toBe(false);
  });

  it("isExpired: past period end → true", () => {
    expect(isExpired(ACTIVE_SUB, NOW + 25 * 86_400_000)).toBe(true);
  });

  it("daysUntilRenewal: ~20 days", () => {
    expect(daysUntilRenewal(ACTIVE_SUB, NOW)).toBe(20);
  });

  it("daysUntilRenewal: clamps to 0 if past", () => {
    expect(daysUntilRenewal(ACTIVE_SUB, NOW + 30 * 86_400_000)).toBe(0);
  });

  it("renewSubscription: monthly extends by 30 days", () => {
    const renewed = renewSubscription(ACTIVE_SUB);
    expect(renewed.currentPeriodStart).toBe(ACTIVE_SUB.currentPeriodEnd);
    expect(renewed.currentPeriodEnd).toBe(ACTIVE_SUB.currentPeriodEnd + 30 * 86_400_000);
  });

  it("renewSubscription: resets cancelAtPeriodEnd", () => {
    const cancelled = cancelAtEnd(ACTIVE_SUB);
    expect(renewSubscription(cancelled).cancelAtPeriodEnd).toBe(false);
  });

  it("cancelAtEnd: sets flag", () => {
    expect(cancelAtEnd(ACTIVE_SUB).cancelAtPeriodEnd).toBe(true);
  });

  it("cancelAtEnd is immutable", () => {
    cancelAtEnd(ACTIVE_SUB);
    expect(ACTIVE_SUB.cancelAtPeriodEnd).toBe(false);
  });
});
