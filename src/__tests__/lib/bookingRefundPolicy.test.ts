/**
 * Tests for booking cancellation refund policy.
 */

type RefundType = "full" | "partial" | "none";

interface RefundPolicy {
  fullRefundHoursBeforeCheckIn: number;
  partialRefundPct: number;
  partialRefundHoursBeforeCheckIn: number;
}

const STANDARD_POLICY: RefundPolicy = {
  fullRefundHoursBeforeCheckIn: 24,
  partialRefundPct: 50,
  partialRefundHoursBeforeCheckIn: 12,
};

function getRefundType(
  hoursUntilCheckIn: number,
  policy: RefundPolicy
): RefundType {
  if (hoursUntilCheckIn >= policy.fullRefundHoursBeforeCheckIn) return "full";
  if (hoursUntilCheckIn >= policy.partialRefundHoursBeforeCheckIn) return "partial";
  return "none";
}

function calculateRefundAmount(
  amountCents: number,
  refundType: RefundType,
  policy: RefundPolicy
): number {
  if (refundType === "full")    return amountCents;
  if (refundType === "partial") return Math.round(amountCents * (policy.partialRefundPct / 100));
  return 0;
}

describe("Booking refund policy", () => {
  it("24h+ before → full refund", () => {
    expect(getRefundType(48, STANDARD_POLICY)).toBe("full");
  });

  it("exactly 24h → full refund (boundary)", () => {
    expect(getRefundType(24, STANDARD_POLICY)).toBe("full");
  });

  it("12-23h before → partial refund", () => {
    expect(getRefundType(18, STANDARD_POLICY)).toBe("partial");
  });

  it("exactly 12h → partial refund (boundary)", () => {
    expect(getRefundType(12, STANDARD_POLICY)).toBe("partial");
  });

  it("less than 12h → no refund", () => {
    expect(getRefundType(6, STANDARD_POLICY)).toBe("none");
  });

  it("0h → no refund", () => {
    expect(getRefundType(0, STANDARD_POLICY)).toBe("none");
  });

  it("full refund amount = 100%", () => {
    expect(calculateRefundAmount(10000, "full", STANDARD_POLICY)).toBe(10000);
  });

  it("partial refund amount = 50%", () => {
    expect(calculateRefundAmount(10000, "partial", STANDARD_POLICY)).toBe(5000);
  });

  it("no refund amount = 0", () => {
    expect(calculateRefundAmount(10000, "none", STANDARD_POLICY)).toBe(0);
  });

  it("partial refund rounds correctly", () => {
    expect(calculateRefundAmount(10001, "partial", STANDARD_POLICY)).toBe(5001);
  });
});
