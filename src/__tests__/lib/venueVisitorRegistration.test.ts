/**
 * Tests for venue visitor registration and check-in management.
 */

interface VisitorRegistration {
  visitorId: string;
  hostId: string;
  venueId: string;
  visitorName: string;
  visitorEmail: string;
  expectedArrivalMs: number;
  actualArrivalMs: number | null;
  departureMs: number | null;
  preApproved: boolean;
}

function isVisitorExpected(reg: VisitorRegistration, windowMs = 3_600_000, nowMs: number): boolean {
  const timeDiff = Math.abs(nowMs - reg.expectedArrivalMs);
  return timeDiff <= windowMs;
}

function checkInVisitor(reg: VisitorRegistration, nowMs: number): VisitorRegistration {
  if (reg.actualArrivalMs !== null) throw new Error("Already checked in");
  return { ...reg, actualArrivalMs: nowMs };
}

function checkOutVisitor(reg: VisitorRegistration, nowMs: number): VisitorRegistration {
  if (reg.actualArrivalMs === null) throw new Error("Not checked in");
  if (reg.departureMs !== null) throw new Error("Already checked out");
  return { ...reg, departureMs: nowMs };
}

function visitDurationMinutes(reg: VisitorRegistration, nowMs: number): number | null {
  if (reg.actualArrivalMs === null) return null;
  const end = reg.departureMs ?? nowMs;
  return Math.round((end - reg.actualArrivalMs) / 60_000);
}

function pendingVisitors(
  registrations: VisitorRegistration[],
  venueId: string,
  nowMs: number
): VisitorRegistration[] {
  return registrations.filter(
    (r) => r.venueId === venueId && r.actualArrivalMs === null && r.expectedArrivalMs > nowMs - 3_600_000
  );
}

const NOW = 1_700_000_000_000;
const REG: VisitorRegistration = {
  visitorId: "v1", hostId: "u1", venueId: "ws1",
  visitorName: "John Doe", visitorEmail: "john@example.com",
  expectedArrivalMs: NOW + 30 * 60_000, // arriving in 30 min
  actualArrivalMs: null, departureMs: null, preApproved: true,
};

describe("Venue visitor registration", () => {
  it("isVisitorExpected: within 1h window → true", () => {
    expect(isVisitorExpected(REG, 3_600_000, NOW)).toBe(true);
  });

  it("isVisitorExpected: outside window → false", () => {
    expect(isVisitorExpected(REG, 3_600_000, NOW + 5_000_000)).toBe(false);
  });

  it("checkInVisitor: sets actualArrivalMs", () => {
    const checked = checkInVisitor(REG, NOW);
    expect(checked.actualArrivalMs).toBe(NOW);
  });

  it("checkInVisitor: throws if already checked in", () => {
    const alreadyIn = { ...REG, actualArrivalMs: NOW - 1000 };
    expect(() => checkInVisitor(alreadyIn, NOW)).toThrow("Already checked in");
  });

  it("checkOutVisitor: sets departureMs", () => {
    const checkedIn = checkInVisitor(REG, NOW - 3600_000);
    const checkedOut = checkOutVisitor(checkedIn, NOW);
    expect(checkedOut.departureMs).toBe(NOW);
  });

  it("checkOutVisitor: throws if not checked in", () => {
    expect(() => checkOutVisitor(REG, NOW)).toThrow("Not checked in");
  });

  it("visitDurationMinutes: 60 min stay", () => {
    const reg = { ...REG, actualArrivalMs: NOW - 3_600_000, departureMs: NOW };
    expect(visitDurationMinutes(reg, NOW)).toBe(60);
  });

  it("visitDurationMinutes: not checked in → null", () => {
    expect(visitDurationMinutes(REG, NOW)).toBeNull();
  });
});
