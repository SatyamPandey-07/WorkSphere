/**
 * Tests for venue tiered deposit requirements based on booking value.
 */

interface DepositTier {
  minBookingCents: number;
  maxBookingCents: number;
  depositPct: number;
  refundPolicyDays: number; // days before booking for full refund
}

const DEPOSIT_TIERS: DepositTier[] = [
  { minBookingCents: 0,       maxBookingCents: 5_000,  depositPct: 20, refundPolicyDays: 1 },
  { minBookingCents: 5_001,   maxBookingCents: 20_000, depositPct: 30, refundPolicyDays: 3 },
  { minBookingCents: 20_001,  maxBookingCents: 50_000, depositPct: 40, refundPolicyDays: 7 },
  { minBookingCents: 50_001,  maxBookingCents: Infinity,depositPct: 50, refundPolicyDays: 14 },
];

function getDepositTier(bookingCents: number): DepositTier {
  return DEPOSIT_TIERS.find(
    (t) => bookingCents >= t.minBookingCents && bookingCents <= t.maxBookingCents
  ) ?? DEPOSIT_TIERS[0];
}

function requiredDeposit(bookingCents: number): number {
  const tier = getDepositTier(bookingCents);
  return Math.round(bookingCents * (tier.depositPct / 100));
}

function isFullRefundEligible(
  bookingCents: number,
  daysUntilBooking: number
): boolean {
  const tier = getDepositTier(bookingCents);
  return daysUntilBooking >= tier.refundPolicyDays;
}

function remainingAfterDeposit(bookingCents: number): number {
  return bookingCents - requiredDeposit(bookingCents);
}

describe("Venue booking deposit tiers", () => {
  it("getDepositTier: 3000 → 20% tier", () => {
    expect(getDepositTier(3000).depositPct).toBe(20);
  });

  it("getDepositTier: 10000 → 30% tier", () => {
    expect(getDepositTier(10_000).depositPct).toBe(30);
  });

  it("getDepositTier: 100000 → 50% tier", () => {
    expect(getDepositTier(100_000).depositPct).toBe(50);
  });

  it("requiredDeposit: 20% of 5000 = 1000", () => {
    expect(requiredDeposit(5000)).toBe(1000);
  });

  it("requiredDeposit: 30% of 10000 = 3000", () => {
    expect(requiredDeposit(10_000)).toBe(3000);
  });

  it("isFullRefundEligible: 3000 with 2 days → true (1-day policy)", () => {
    expect(isFullRefundEligible(3000, 2)).toBe(true);
  });

  it("isFullRefundEligible: 100000 with 10 days → false (14-day policy)", () => {
    expect(isFullRefundEligible(100_000, 10)).toBe(false);
  });

  it("remainingAfterDeposit: 5000 - 1000 = 4000", () => {
    expect(remainingAfterDeposit(5000)).toBe(4000);
  });
});
