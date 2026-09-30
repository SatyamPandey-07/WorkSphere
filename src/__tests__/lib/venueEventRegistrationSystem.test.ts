/**
 * Tests for venue event registration system with waitlist.
 */

interface EventRegistration {
  registrationId: string;
  eventId: string;
  userId: string;
  status: "registered" | "waitlisted" | "cancelled" | "attended";
  registeredAt: number;
  position: number | null; // waitlist position
}

function registerForEvent(
  registrations: EventRegistration[],
  eventId: string,
  userId: string,
  maxCapacity: number,
  nowMs: number
): EventRegistration {
  if (registrations.some((r) => r.userId === userId && r.eventId === eventId && r.status !== "cancelled")) {
    throw new Error("Already registered");
  }

  const activeCount = registrations.filter(
    (r) => r.eventId === eventId && r.status === "registered"
  ).length;

  const waitlistCount = registrations.filter(
    (r) => r.eventId === eventId && r.status === "waitlisted"
  ).length;

  if (activeCount < maxCapacity) {
    return { registrationId: `reg-${nowMs}`, eventId, userId, status: "registered", registeredAt: nowMs, position: null };
  }

  return { registrationId: `wait-${nowMs}`, eventId, userId, status: "waitlisted", registeredAt: nowMs, position: waitlistCount + 1 };
}

function cancelRegistration(
  registration: EventRegistration
): EventRegistration {
  if (registration.status === "attended") throw new Error("Cannot cancel attended registration");
  return { ...registration, status: "cancelled" };
}

function attendanceRate(registrations: EventRegistration[], eventId: string): number {
  const event = registrations.filter((r) => r.eventId === eventId && r.status !== "cancelled");
  if (event.length === 0) return 0;
  const attended = event.filter((r) => r.status === "attended").length;
  return Math.round((attended / event.length) * 100);
}

const NOW = 1_700_000_000_000;
const REGISTRATIONS: EventRegistration[] = [
  { registrationId: "r1", eventId: "e1", userId: "u1", status: "registered",  registeredAt: NOW - 3000, position: null },
  { registrationId: "r2", eventId: "e1", userId: "u2", status: "attended",    registeredAt: NOW - 2000, position: null },
  { registrationId: "r3", eventId: "e1", userId: "u3", status: "waitlisted",  registeredAt: NOW - 1000, position: 1    },
];

describe("Venue event registration system", () => {
  it("registerForEvent: within capacity → registered", () => {
    const reg = registerForEvent(REGISTRATIONS, "e1", "u4", 5, NOW);
    expect(reg.status).toBe("registered");
    expect(reg.position).toBeNull();
  });

  it("registerForEvent: at capacity → waitlisted", () => {
    const reg = registerForEvent(REGISTRATIONS, "e1", "u4", 2, NOW);
    expect(reg.status).toBe("waitlisted");
    expect(reg.position).toBe(2); // waitlist position
  });

  it("registerForEvent: already registered → throws", () => {
    expect(() => registerForEvent(REGISTRATIONS, "e1", "u1", 5, NOW)).toThrow("Already registered");
  });

  it("cancelRegistration: registered → cancelled", () => {
    const cancelled = cancelRegistration(REGISTRATIONS[0]);
    expect(cancelled.status).toBe("cancelled");
  });

  it("cancelRegistration: attended → throws", () => {
    expect(() => cancelRegistration(REGISTRATIONS[1])).toThrow("Cannot cancel");
  });

  it("attendanceRate: 1 attended of 3 non-cancelled = 33%", () => {
    expect(attendanceRate(REGISTRATIONS, "e1")).toBe(33);
  });
});
