/**
 * Tests for venue booking policy rules enforcement.
 */

interface VenueBookingPolicy {
  venueId: string;
  minBookingHours: number;
  maxBookingHours: number;
  maxAdvanceBookingDays: number;
  requireApproval: boolean;
  allowSameDayBooking: boolean;
  minNoticeHours: number; // hours before start
}

interface BookingRequest {
  venueId: string;
  userId: string;
  durationHours: number;
  hoursFromNow: number; // when booking starts
  advanceDays: number;  // how many days in advance
}

interface PolicyCheckResult {
  allowed: boolean;
  violations: string[];
}

function checkPolicy(
  request: BookingRequest,
  policy: VenueBookingPolicy
): PolicyCheckResult {
  const violations: string[] = [];

  if (request.durationHours < policy.minBookingHours) {
    violations.push(`Minimum booking is ${policy.minBookingHours}h`);
  }
  if (request.durationHours > policy.maxBookingHours) {
    violations.push(`Maximum booking is ${policy.maxBookingHours}h`);
  }
  if (request.advanceDays > policy.maxAdvanceBookingDays) {
    violations.push(`Cannot book more than ${policy.maxAdvanceBookingDays} days in advance`);
  }
  if (!policy.allowSameDayBooking && request.advanceDays === 0) {
    violations.push("Same-day booking not allowed");
  }
  if (request.hoursFromNow < policy.minNoticeHours) {
    violations.push(`Minimum ${policy.minNoticeHours}h notice required`);
  }

  return { allowed: violations.length === 0, violations };
}

const POLICY: VenueBookingPolicy = {
  venueId: "v1", minBookingHours: 1, maxBookingHours: 8,
  maxAdvanceBookingDays: 30, requireApproval: false,
  allowSameDayBooking: true, minNoticeHours: 2,
};

describe("Venue booking policy enforcement", () => {
  it("valid request → allowed", () => {
    const result = checkPolicy({ venueId: "v1", userId: "u1", durationHours: 3, hoursFromNow: 4, advanceDays: 5 }, POLICY);
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("too short → violation", () => {
    const result = checkPolicy({ venueId: "v1", userId: "u1", durationHours: 0.5, hoursFromNow: 4, advanceDays: 1 }, POLICY);
    expect(result.violations.some((v) => /minimum/i.test(v))).toBe(true);
  });

  it("too long → violation", () => {
    const result = checkPolicy({ venueId: "v1", userId: "u1", durationHours: 10, hoursFromNow: 4, advanceDays: 1 }, POLICY);
    expect(result.violations.some((v) => /maximum/i.test(v))).toBe(true);
  });

  it("too far in advance → violation", () => {
    const result = checkPolicy({ venueId: "v1", userId: "u1", durationHours: 2, hoursFromNow: 4, advanceDays: 31 }, POLICY);
    expect(result.violations.some((v) => /advance/i.test(v))).toBe(true);
  });

  it("same-day blocked → violation", () => {
    const noSameDay = { ...POLICY, allowSameDayBooking: false };
    const result = checkPolicy({ venueId: "v1", userId: "u1", durationHours: 2, hoursFromNow: 4, advanceDays: 0 }, noSameDay);
    expect(result.violations.some((v) => /same-day/i.test(v))).toBe(true);
  });

  it("notice too short → violation", () => {
    const result = checkPolicy({ venueId: "v1", userId: "u1", durationHours: 2, hoursFromNow: 1, advanceDays: 0 }, POLICY);
    expect(result.violations.some((v) => /notice/i.test(v))).toBe(true);
  });

  it("multiple violations collected", () => {
    const result = checkPolicy({ venueId: "v1", userId: "u1", durationHours: 0.5, hoursFromNow: 1, advanceDays: 35 }, POLICY);
    expect(result.violations.length).toBeGreaterThan(1);
  });
});
