/**
 * Tests for venue open house / free trial day management.
 */

interface OpenHouseEvent {
  eventId: string;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  maxAttendees: number;
  registeredCount: number;
  requiresRegistration: boolean;
  isPublic: boolean;
  amenitiesShowcased: string[];
}

function canAttendOpenHouse(
  event: OpenHouseEvent,
  nowDateStr: string,
  registeredUserIds: string[],
  userId: string
): { canAttend: boolean; reason: string } {
  if (event.date < nowDateStr) return { canAttend: false, reason: "Event has passed" };
  if (event.requiresRegistration && !registeredUserIds.includes(userId)) {
    return { canAttend: false, reason: "Registration required" };
  }
  if (event.registeredCount >= event.maxAttendees) {
    return { canAttend: false, reason: "Event is full" };
  }
  return { canAttend: true, reason: "" };
}

function registerForOpenHouse(event: OpenHouseEvent): OpenHouseEvent {
  if (event.registeredCount >= event.maxAttendees) throw new Error("Event full");
  return { ...event, registeredCount: event.registeredCount + 1 };
}

function openHouseDuration(event: OpenHouseEvent): number {
  const [oh, om] = event.startTime.split(":").map(Number);
  const [ch, cm] = event.endTime.split(":").map(Number);
  return (ch * 60 + cm) - (oh * 60 + om);
}

const EVENT: OpenHouseEvent = {
  eventId: "oh1", venueId: "v1", date: "2026-10-15",
  startTime: "10:00", endTime: "14:00",
  maxAttendees: 50, registeredCount: 30,
  requiresRegistration: false, isPublic: true,
  amenitiesShowcased: ["wifi", "standing-desks", "coffee"],
};

describe("Venue open house events", () => {
  it("canAttendOpenHouse: open event with availability → true", () => {
    const { canAttend } = canAttendOpenHouse(EVENT, "2026-10-01", [], "u1");
    expect(canAttend).toBe(true);
  });

  it("canAttendOpenHouse: past event → false", () => {
    const { canAttend, reason } = canAttendOpenHouse(EVENT, "2026-10-20", [], "u1");
    expect(canAttend).toBe(false);
    expect(reason).toContain("passed");
  });

  it("canAttendOpenHouse: registration required but not registered → false", () => {
    const regReq = { ...EVENT, requiresRegistration: true };
    const { canAttend } = canAttendOpenHouse(regReq, "2026-10-01", ["u2"], "u1");
    expect(canAttend).toBe(false);
  });

  it("canAttendOpenHouse: full event → false", () => {
    const full = { ...EVENT, registeredCount: 50 };
    const { canAttend } = canAttendOpenHouse(full, "2026-10-01", [], "u1");
    expect(canAttend).toBe(false);
  });

  it("registerForOpenHouse: increments count", () => {
    const updated = registerForOpenHouse(EVENT);
    expect(updated.registeredCount).toBe(31);
  });

  it("registerForOpenHouse: throws when full", () => {
    const full = { ...EVENT, registeredCount: 50 };
    expect(() => registerForOpenHouse(full)).toThrow("full");
  });

  it("openHouseDuration: 10am-2pm = 240 min", () => {
    expect(openHouseDuration(EVENT)).toBe(240);
  });
});
