/**
 * Tests for event sourcing pattern for booking state management.
 */

type BookingEvent =
  | { type: "booking_created"; bookingId: string; venueId: string; userId: string; seatId: string; startMs: number; endMs: number; priceCents: number }
  | { type: "booking_confirmed"; bookingId: string; confirmedAt: number }
  | { type: "booking_checked_in"; bookingId: string; checkedInAt: number }
  | { type: "booking_cancelled"; bookingId: string; cancelledAt: number; reason: string };

interface BookingProjection {
  bookingId: string;
  venueId: string;
  userId: string;
  status: "created" | "confirmed" | "checked_in" | "cancelled";
  seatId: string;
  startMs: number;
  endMs: number;
  priceCents: number;
  confirmedAt: number | null;
  checkedInAt: number | null;
  cancelledAt: number | null;
  version: number;
}

function applyEvent(
  projection: BookingProjection | null,
  event: BookingEvent
): BookingProjection {
  if (event.type === "booking_created") {
    return {
      bookingId: event.bookingId, venueId: event.venueId, userId: event.userId,
      status: "created", seatId: event.seatId, startMs: event.startMs, endMs: event.endMs,
      priceCents: event.priceCents, confirmedAt: null, checkedInAt: null, cancelledAt: null,
      version: 1,
    };
  }

  if (!projection) throw new Error("No existing projection for update event");

  switch (event.type) {
    case "booking_confirmed":
      return { ...projection, status: "confirmed", confirmedAt: event.confirmedAt, version: projection.version + 1 };
    case "booking_checked_in":
      return { ...projection, status: "checked_in", checkedInAt: event.checkedInAt, version: projection.version + 1 };
    case "booking_cancelled":
      return { ...projection, status: "cancelled", cancelledAt: event.cancelledAt, version: projection.version + 1 };
  }
}

function rebuildFromEvents(events: BookingEvent[]): BookingProjection | null {
  let projection: BookingProjection | null = null;
  for (const event of events) {
    projection = applyEvent(projection, event);
  }
  return projection;
}

const NOW = 1_700_000_000_000;
const EVENTS: BookingEvent[] = [
  { type: "booking_created", bookingId: "b1", venueId: "v1", userId: "u1", seatId: "s1", startMs: NOW + 3600_000, endMs: NOW + 7200_000, priceCents: 5000 },
  { type: "booking_confirmed", bookingId: "b1", confirmedAt: NOW + 100 },
  { type: "booking_checked_in", bookingId: "b1", checkedInAt: NOW + 3600_000 },
];

describe("Booking event sourcing", () => {
  it("rebuildFromEvents: final state = checked_in", () => {
    const projection = rebuildFromEvents(EVENTS);
    expect(projection!.status).toBe("checked_in");
  });

  it("rebuildFromEvents: version = 3 (3 events)", () => {
    const projection = rebuildFromEvents(EVENTS);
    expect(projection!.version).toBe(3);
  });

  it("rebuildFromEvents: all timestamps preserved", () => {
    const projection = rebuildFromEvents(EVENTS);
    expect(projection!.confirmedAt).toBe(NOW + 100);
    expect(projection!.checkedInAt).toBe(NOW + 3600_000);
  });

  it("applyEvent: cancelled event sets status", () => {
    const cancelled: BookingEvent = { type: "booking_cancelled", bookingId: "b1", cancelledAt: NOW + 200, reason: "Changed mind" };
    const baseProjection = rebuildFromEvents(EVENTS.slice(0, 2))!;
    const result = applyEvent(baseProjection, cancelled);
    expect(result.status).toBe("cancelled");
  });

  it("rebuildFromEvents: empty events → null", () => {
    expect(rebuildFromEvents([])).toBeNull();
  });
});
