/**
 * Tests for event RSVP capacity limiting.
 */

interface EventRsvp {
  eventId: string;
  userId: string;
  status: "attending" | "waitlisted" | "cancelled";
  registeredAt: number;
}

function attending(rsvps: EventRsvp[]): EventRsvp[] {
  return rsvps.filter((r) => r.status === "attending");
}

function canRsvp(
  rsvps: EventRsvp[],
  maxAttendees: number,
  userId: string
): { canJoin: boolean; willWaitlist: boolean } {
  const alreadyIn = rsvps.some(
    (r) => r.userId === userId && r.status !== "cancelled"
  );
  if (alreadyIn) return { canJoin: false, willWaitlist: false };
  const attendingCount = attending(rsvps).length;
  if (attendingCount < maxAttendees) return { canJoin: true, willWaitlist: false };
  return { canJoin: true, willWaitlist: true };
}

function cancelRsvp(rsvps: EventRsvp[], userId: string): EventRsvp[] {
  return rsvps.map((r) =>
    r.userId === userId && r.status !== "cancelled"
      ? { ...r, status: "cancelled" as const }
      : r
  );
}

const BASE = 1_700_000_000_000;
const RSVPS: EventRsvp[] = [
  { eventId: "e1", userId: "u1", status: "attending",  registeredAt: BASE },
  { eventId: "e1", userId: "u2", status: "attending",  registeredAt: BASE + 100 },
  { eventId: "e1", userId: "u3", status: "waitlisted", registeredAt: BASE + 200 },
];

describe("Event RSVP capacity", () => {
  it("attending count is 2", () => {
    expect(attending(RSVPS)).toHaveLength(2);
  });

  it("canRsvp: slot available → join without waitlist", () => {
    const result = canRsvp(RSVPS, 3, "u4");
    expect(result.canJoin).toBe(true);
    expect(result.willWaitlist).toBe(false);
  });

  it("canRsvp: event full → waitlist", () => {
    const result = canRsvp(RSVPS, 2, "u4");
    expect(result.canJoin).toBe(true);
    expect(result.willWaitlist).toBe(true);
  });

  it("canRsvp: user already attending → cannot join", () => {
    const result = canRsvp(RSVPS, 10, "u1");
    expect(result.canJoin).toBe(false);
  });

  it("canRsvp: user already waitlisted → cannot join", () => {
    const result = canRsvp(RSVPS, 10, "u3");
    expect(result.canJoin).toBe(false);
  });

  it("cancelRsvp marks user as cancelled", () => {
    const updated = cancelRsvp(RSVPS, "u1");
    expect(updated.find((r) => r.userId === "u1")!.status).toBe("cancelled");
  });

  it("cancelRsvp does not affect others", () => {
    const updated = cancelRsvp(RSVPS, "u1");
    expect(updated.find((r) => r.userId === "u2")!.status).toBe("attending");
  });

  it("cancelRsvp is immutable", () => {
    cancelRsvp(RSVPS, "u2");
    expect(RSVPS.find((r) => r.userId === "u2")!.status).toBe("attending");
  });
});
