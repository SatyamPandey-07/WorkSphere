/**
 * Tests for workspace capacity-based booking reservation constraints.
 */

interface CapacityRule {
  venueId: string;
  maxGroupBooking: number;    // max people per booking
  minGroupBooking: number;    // min people (0 = no minimum)
  requireApprovalAbove: number; // needs approval for groups above this
  largeGroupDiscount: number;   // % off for maxGroupBooking
}

interface BookingRequest {
  userId: string;
  venueId: string;
  groupSize: number;
  requestedSeats: number;
}

function validateGroupBooking(
  request: BookingRequest,
  rule: CapacityRule
): { valid: boolean; needsApproval: boolean; errors: string[] } {
  const errors: string[] = [];

  if (request.groupSize < rule.minGroupBooking) {
    errors.push(`Minimum group size is ${rule.minGroupBooking}`);
  }
  if (request.groupSize > rule.maxGroupBooking) {
    errors.push(`Maximum group size is ${rule.maxGroupBooking}`);
  }
  if (request.requestedSeats < request.groupSize) {
    errors.push("Not enough seats requested for group");
  }

  const needsApproval = errors.length === 0 && request.groupSize > rule.requireApprovalAbove;
  return { valid: errors.length === 0, needsApproval, errors };
}

function applyGroupDiscount(
  priceCents: number,
  groupSize: number,
  rule: CapacityRule
): number {
  if (groupSize < rule.maxGroupBooking) return priceCents;
  return Math.round(priceCents * (1 - rule.largeGroupDiscount / 100));
}

const RULE: CapacityRule = {
  venueId: "v1", maxGroupBooking: 20, minGroupBooking: 1,
  requireApprovalAbove: 10, largeGroupDiscount: 15,
};

describe("Booking capacity reservation", () => {
  it("valid small group: no approval needed", () => {
    const result = validateGroupBooking({ userId: "u1", venueId: "v1", groupSize: 5, requestedSeats: 5 }, RULE);
    expect(result.valid).toBe(true);
    expect(result.needsApproval).toBe(false);
  });

  it("valid large group: needs approval", () => {
    const result = validateGroupBooking({ userId: "u1", venueId: "v1", groupSize: 15, requestedSeats: 15 }, RULE);
    expect(result.valid).toBe(true);
    expect(result.needsApproval).toBe(true);
  });

  it("exceeds max group → error", () => {
    const result = validateGroupBooking({ userId: "u1", venueId: "v1", groupSize: 25, requestedSeats: 25 }, RULE);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /maximum/i.test(e))).toBe(true);
  });

  it("insufficient seats → error", () => {
    const result = validateGroupBooking({ userId: "u1", venueId: "v1", groupSize: 10, requestedSeats: 5 }, RULE);
    expect(result.errors.some((e) => /enough seats/i.test(e))).toBe(true);
  });

  it("applyGroupDiscount: max group gets 15% off", () => {
    expect(applyGroupDiscount(10000, 20, RULE)).toBe(8500);
  });

  it("applyGroupDiscount: smaller group no discount", () => {
    expect(applyGroupDiscount(10000, 10, RULE)).toBe(10000);
  });
});
