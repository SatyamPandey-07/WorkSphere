/**
 * Tests for booking date change (reschedule) handling.
 */

interface RescheduleRequest {
  requestId: string;
  originalBookingId: string;
  userId: string;
  newStartMs: number;
  newEndMs: number;
  reason: string;
  requestedAt: number;
  feeCharged: boolean;
  feeAmountCents: number;
  status: "pending" | "approved" | "rejected";
}

interface ReschedulePolicy {
  venueId: string;
  maxReschedulesPerBooking: number;
  freeRescheduleHoursBeforeStart: number;
  rescheduleFeePercent: number; // % of booking value
}

function calculateRescheduleFee(
  bookingCents: number,
  hoursBeforeStart: number,
  policy: ReschedulePolicy
): number {
  if (hoursBeforeStart >= policy.freeRescheduleHoursBeforeStart) return 0;
  return Math.round(bookingCents * (policy.rescheduleFeePercent / 100));
}

function canReschedule(
  previousReschedules: number,
  hoursBeforeStart: number,
  policy: ReschedulePolicy
): { allowed: boolean; reason?: string } {
  if (previousReschedules >= policy.maxReschedulesPerBooking) {
    return { allowed: false, reason: `Max ${policy.maxReschedulesPerBooking} reschedules reached` };
  }
  if (hoursBeforeStart <= 0) {
    return { allowed: false, reason: "Cannot reschedule past bookings" };
  }
  return { allowed: true };
}

function approveReschedule(req: RescheduleRequest, nowMs: number): RescheduleRequest {
  if (req.status !== "pending") throw new Error("Request not pending");
  return { ...req, status: "approved" };
}

const POLICY: ReschedulePolicy = {
  venueId: "v1",
  maxReschedulesPerBooking: 2,
  freeRescheduleHoursBeforeStart: 24,
  rescheduleFeePercent: 10,
};

describe("Booking reschedule handling", () => {
  it("calculateRescheduleFee: 48h before → free (0)", () => {
    expect(calculateRescheduleFee(10_000, 48, POLICY)).toBe(0);
  });

  it("calculateRescheduleFee: 12h before → 10% fee = 1000", () => {
    expect(calculateRescheduleFee(10_000, 12, POLICY)).toBe(1000);
  });

  it("calculateRescheduleFee: exactly at threshold → free", () => {
    expect(calculateRescheduleFee(10_000, 24, POLICY)).toBe(0);
  });

  it("canReschedule: 0 previous, 48h → allowed", () => {
    expect(canReschedule(0, 48, POLICY).allowed).toBe(true);
  });

  it("canReschedule: max reschedules → not allowed", () => {
    expect(canReschedule(2, 48, POLICY).allowed).toBe(false);
  });

  it("canReschedule: past booking → not allowed", () => {
    expect(canReschedule(0, -1, POLICY).allowed).toBe(false);
  });

  it("approveReschedule: pending → approved", () => {
    const req: RescheduleRequest = {
      requestId: "r1", originalBookingId: "b1", userId: "u1",
      newStartMs: 0, newEndMs: 3600_000, reason: "conflict",
      requestedAt: 0, feeCharged: false, feeAmountCents: 0, status: "pending",
    };
    expect(approveReschedule(req, 0).status).toBe("approved");
  });

  it("approveReschedule: throws if not pending", () => {
    const req: RescheduleRequest = {
      requestId: "r2", originalBookingId: "b1", userId: "u1",
      newStartMs: 0, newEndMs: 0, reason: "", requestedAt: 0,
      feeCharged: false, feeAmountCents: 0, status: "approved",
    };
    expect(() => approveReschedule(req, 0)).toThrow("not pending");
  });
});
