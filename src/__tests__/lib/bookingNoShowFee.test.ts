/**
 * Tests for booking no-show fee calculation and dispute.
 */

interface NoShowFeePolicy {
  venueId: string;
  noShowFeePercent: number;   // % of booking total
  gracePeriodMinutes: number; // minutes after scheduled start before no-show
  maxFeeCents: number;
}

interface NoShowEvent {
  bookingId: string;
  scheduledStartMs: number;
  checkInMs: number | null;
  totalBookingCents: number;
  status: "arrived" | "no_show" | "grace_period";
}

function classifyAttendance(
  event: NoShowEvent,
  policy: NoShowFeePolicy,
  nowMs: number
): "arrived" | "no_show" | "grace_period" | "pending" {
  if (event.checkInMs !== null) return "arrived";
  const minutesLate = (nowMs - event.scheduledStartMs) / 60_000;
  if (minutesLate < 0) return "pending";
  if (minutesLate <= policy.gracePeriodMinutes) return "grace_period";
  return "no_show";
}

function calculateNoShowFee(
  totalCents: number,
  policy: NoShowFeePolicy
): number {
  const fee = Math.round(totalCents * (policy.noShowFeePercent / 100));
  return Math.min(fee, policy.maxFeeCents);
}

function waiveFee(reason: string, validWaivers: string[]): boolean {
  return validWaivers.some((w) => reason.toLowerCase().includes(w.toLowerCase()));
}

const POLICY: NoShowFeePolicy = {
  venueId: "v1", noShowFeePercent: 50, gracePeriodMinutes: 15, maxFeeCents: 5000,
};

const NOW = 1_700_000_000_000;
const EVENT: NoShowEvent = {
  bookingId: "b1", scheduledStartMs: NOW - 1800_000, // 30 min ago
  checkInMs: null, totalBookingCents: 8000, status: "no_show",
};

describe("Booking no-show fee", () => {
  it("classifyAttendance: checked in → arrived", () => {
    const checkedIn = { ...EVENT, checkInMs: NOW - 1000 };
    expect(classifyAttendance(checkedIn, POLICY, NOW)).toBe("arrived");
  });

  it("classifyAttendance: 30 min late, no check-in → no_show", () => {
    expect(classifyAttendance(EVENT, POLICY, NOW)).toBe("no_show");
  });

  it("classifyAttendance: 10 min late → grace_period", () => {
    const recent = { ...EVENT, scheduledStartMs: NOW - 10 * 60_000 };
    expect(classifyAttendance(recent, POLICY, NOW)).toBe("grace_period");
  });

  it("classifyAttendance: not yet started → pending", () => {
    const future = { ...EVENT, scheduledStartMs: NOW + 3600_000 };
    expect(classifyAttendance(future, POLICY, NOW)).toBe("pending");
  });

  it("calculateNoShowFee: 50% of 8000 = 4000", () => {
    expect(calculateNoShowFee(8000, POLICY)).toBe(4000);
  });

  it("calculateNoShowFee: capped at maxFeeCents", () => {
    expect(calculateNoShowFee(20000, POLICY)).toBe(5000);
  });

  it("waiveFee: emergency reason accepted", () => {
    expect(waiveFee("medical emergency", ["emergency", "illness", "accident"])).toBe(true);
  });

  it("waiveFee: trivial reason not accepted", () => {
    expect(waiveFee("forgot to cancel", ["emergency", "illness", "accident"])).toBe(false);
  });
});
