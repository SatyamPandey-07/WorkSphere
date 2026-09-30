/**
 * Tests for booking cancellation fee calculation.
 */

interface CancellationPolicy {
  freeWindowHours: number;    // no fee if cancelled this many hours before check-in
  lateFeePercent: number;     // % of total cost charged if cancelled within window
  noShowFeePercent: number;   // % charged for no-show
}

const STANDARD_POLICY: CancellationPolicy = {
  freeWindowHours: 24,
  lateFeePercent: 25,
  noShowFeePercent: 100,
};

type CancellationType = "free" | "late" | "no_show";

function getCancellationType(
  hoursUntilCheckIn: number,
  policy: CancellationPolicy
): CancellationType {
  if (hoursUntilCheckIn < 0) return "no_show";
  if (hoursUntilCheckIn >= policy.freeWindowHours) return "free";
  return "late";
}

function cancellationFee(
  totalCents: number,
  cancellationType: CancellationType,
  policy: CancellationPolicy
): number {
  if (cancellationType === "free")     return 0;
  if (cancellationType === "no_show")  return Math.round(totalCents * (policy.noShowFeePercent / 100));
  return Math.round(totalCents * (policy.lateFeePercent / 100));
}

describe("Booking cancellation fee", () => {
  it("48h before → free cancellation", () => {
    expect(getCancellationType(48, STANDARD_POLICY)).toBe("free");
  });

  it("exactly 24h before → free (boundary)", () => {
    expect(getCancellationType(24, STANDARD_POLICY)).toBe("free");
  });

  it("23h before → late cancellation", () => {
    expect(getCancellationType(23, STANDARD_POLICY)).toBe("late");
  });

  it("negative hours (past check-in) → no_show", () => {
    expect(getCancellationType(-1, STANDARD_POLICY)).toBe("no_show");
  });

  it("free cancellation fee = 0", () => {
    expect(cancellationFee(10000, "free", STANDARD_POLICY)).toBe(0);
  });

  it("late cancellation = 25% of total", () => {
    expect(cancellationFee(10000, "late", STANDARD_POLICY)).toBe(2500);
  });

  it("no_show fee = 100% of total", () => {
    expect(cancellationFee(10000, "no_show", STANDARD_POLICY)).toBe(10000);
  });

  it("fee rounds correctly on non-round amount", () => {
    expect(cancellationFee(1003, "late", STANDARD_POLICY)).toBe(251);
  });

  it("0 cost booking: fee always 0", () => {
    expect(cancellationFee(0, "late", STANDARD_POLICY)).toBe(0);
    expect(cancellationFee(0, "no_show", STANDARD_POLICY)).toBe(0);
  });
});
