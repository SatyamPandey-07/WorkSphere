/**
 * Tests for event space booking capacity validation.
 */

interface EventSpaceBooking {
  venueId: string;
  maxCapacity: number;
  attendees: number;
  setupMinutes: number;
  teardownMinutes: number;
  eventDurationMinutes: number;
}

function totalBlockedMinutes(booking: EventSpaceBooking): number {
  return booking.setupMinutes + booking.eventDurationMinutes + booking.teardownMinutes;
}

function isCapacityValid(booking: EventSpaceBooking): boolean {
  return booking.attendees > 0 && booking.attendees <= booking.maxCapacity;
}

function densityWarning(
  booking: EventSpaceBooking,
  sqFtPerPerson = 20
): boolean {
  // Warn if venue would need more than a generous area allowance
  const assumedSqFt = booking.maxCapacity * sqFtPerPerson;
  return booking.attendees > assumedSqFt / sqFtPerPerson;
}

function blockoutSlot(
  startMinutes: number,
  booking: EventSpaceBooking
): { start: number; end: number } {
  return {
    start: startMinutes - booking.setupMinutes,
    end: startMinutes + booking.eventDurationMinutes + booking.teardownMinutes,
  };
}

const BOOKING: EventSpaceBooking = {
  venueId: "v1",
  maxCapacity: 100,
  attendees: 80,
  setupMinutes: 30,
  teardownMinutes: 20,
  eventDurationMinutes: 120,
};

describe("Event space booking", () => {
  it("totalBlockedMinutes sums setup+event+teardown", () => {
    expect(totalBlockedMinutes(BOOKING)).toBe(170);
  });

  it("valid attendee count", () => {
    expect(isCapacityValid(BOOKING)).toBe(true);
  });

  it("attendees exceeds capacity → invalid", () => {
    expect(isCapacityValid({ ...BOOKING, attendees: 101 })).toBe(false);
  });

  it("zero attendees → invalid", () => {
    expect(isCapacityValid({ ...BOOKING, attendees: 0 })).toBe(false);
  });

  it("density not a warning when within capacity", () => {
    expect(densityWarning(BOOKING)).toBe(false);
  });

  it("density warning when attendees exceed capacity", () => {
    expect(densityWarning({ ...BOOKING, attendees: 101 })).toBe(true);
  });

  it("blockout slot starts before event", () => {
    const slot = blockoutSlot(600, BOOKING);
    expect(slot.start).toBe(570);
  });

  it("blockout slot ends after teardown", () => {
    const slot = blockoutSlot(600, BOOKING);
    expect(slot.end).toBe(740);
  });
});
