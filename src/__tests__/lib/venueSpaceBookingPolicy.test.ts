/**
 * Tests for per-space booking policy configuration.
 */

interface SpaceBookingPolicy {
  spaceId: string;
  venueId: string;
  minBookingMinutes: number;
  maxBookingMinutes: number;
  bufferMinutes: number;   // required gap between bookings
  allowSameDay: boolean;
  minNoticeHours: number;
  allowRecurring: boolean;
  maxOccupants: number;
}

interface BookingRequest {
  spaceId: string;
  durationMinutes: number;
  hoursNotice: number;
  isRecurring: boolean;
  requestedOccupants: number;
  isSameDay: boolean;
}

function validateBookingAgainstPolicy(
  request: BookingRequest,
  policy: SpaceBookingPolicy
): { allowed: boolean; violations: string[] } {
  const violations: string[] = [];

  if (request.durationMinutes < policy.minBookingMinutes) {
    violations.push(`Min ${policy.minBookingMinutes} min`);
  }
  if (request.durationMinutes > policy.maxBookingMinutes) {
    violations.push(`Max ${policy.maxBookingMinutes} min`);
  }
  if (!policy.allowSameDay && request.isSameDay) {
    violations.push("Same-day not allowed");
  }
  if (request.hoursNotice < policy.minNoticeHours) {
    violations.push(`Min ${policy.minNoticeHours}h notice`);
  }
  if (!policy.allowRecurring && request.isRecurring) {
    violations.push("Recurring not allowed");
  }
  if (request.requestedOccupants > policy.maxOccupants) {
    violations.push(`Max ${policy.maxOccupants} occupants`);
  }

  return { allowed: violations.length === 0, violations };
}

const POLICY: SpaceBookingPolicy = {
  spaceId: "sp1", venueId: "v1",
  minBookingMinutes: 30, maxBookingMinutes: 480,
  bufferMinutes: 15, allowSameDay: true, minNoticeHours: 1,
  allowRecurring: true, maxOccupants: 10,
};

describe("Venue space booking policy validation", () => {
  const VALID_REQUEST: BookingRequest = {
    spaceId: "sp1", durationMinutes: 120, hoursNotice: 3,
    isRecurring: false, requestedOccupants: 5, isSameDay: false,
  };

  it("valid request → allowed", () => {
    const { allowed } = validateBookingAgainstPolicy(VALID_REQUEST, POLICY);
    expect(allowed).toBe(true);
  });

  it("too short → violation", () => {
    const req = { ...VALID_REQUEST, durationMinutes: 15 };
    const { violations } = validateBookingAgainstPolicy(req, POLICY);
    expect(violations.some((v) => /Min/i.test(v))).toBe(true);
  });

  it("same day blocked → violation", () => {
    const noSameDay = { ...POLICY, allowSameDay: false };
    const req = { ...VALID_REQUEST, isSameDay: true };
    expect(validateBookingAgainstPolicy(req, noSameDay).violations.length).toBeGreaterThan(0);
  });

  it("insufficient notice → violation", () => {
    const req = { ...VALID_REQUEST, hoursNotice: 0.5 };
    const { violations } = validateBookingAgainstPolicy(req, POLICY);
    expect(violations.some((v) => /notice/i.test(v))).toBe(true);
  });

  it("recurring blocked → violation", () => {
    const noRecurring = { ...POLICY, allowRecurring: false };
    const req = { ...VALID_REQUEST, isRecurring: true };
    expect(validateBookingAgainstPolicy(req, noRecurring).violations.length).toBeGreaterThan(0);
  });

  it("over max occupants → violation", () => {
    const req = { ...VALID_REQUEST, requestedOccupants: 15 };
    const { violations } = validateBookingAgainstPolicy(req, POLICY);
    expect(violations.some((v) => /occupants/i.test(v))).toBe(true);
  });

  it("multiple violations collected", () => {
    const badRequest: BookingRequest = { spaceId: "sp1", durationMinutes: 10, hoursNotice: 0, isRecurring: false, requestedOccupants: 15, isSameDay: false };
    const { violations } = validateBookingAgainstPolicy(badRequest, POLICY);
    expect(violations.length).toBeGreaterThan(1);
  });
});
