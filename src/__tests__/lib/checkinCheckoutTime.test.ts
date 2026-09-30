/**
 * Tests for workspace check-in / check-out time validation.
 */

interface TimeSlot {
  checkIn: string;  // "HH:MM"
  checkOut: string; // "HH:MM"
}

function parseMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function isValidTimeSlot(slot: TimeSlot): boolean {
  return parseMinutes(slot.checkOut) > parseMinutes(slot.checkIn);
}

function durationMinutes(slot: TimeSlot): number {
  return parseMinutes(slot.checkOut) - parseMinutes(slot.checkIn);
}

function durationHours(slot: TimeSlot): number {
  return durationMinutes(slot) / 60;
}

function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  return parseMinutes(a.checkIn) < parseMinutes(b.checkOut) &&
         parseMinutes(a.checkOut) > parseMinutes(b.checkIn);
}

describe("Check-in / check-out time logic", () => {
  it("valid slot: check-out after check-in", () => {
    expect(isValidTimeSlot({ checkIn: "09:00", checkOut: "17:00" })).toBe(true);
  });

  it("invalid slot: check-out before check-in", () => {
    expect(isValidTimeSlot({ checkIn: "17:00", checkOut: "09:00" })).toBe(false);
  });

  it("invalid slot: same time", () => {
    expect(isValidTimeSlot({ checkIn: "09:00", checkOut: "09:00" })).toBe(false);
  });

  it("duration in minutes", () => {
    expect(durationMinutes({ checkIn: "09:00", checkOut: "11:30" })).toBe(150);
  });

  it("duration in hours", () => {
    expect(durationHours({ checkIn: "08:00", checkOut: "10:00" })).toBe(2);
  });

  it("overlapping slots detected", () => {
    const a = { checkIn: "09:00", checkOut: "12:00" };
    const b = { checkIn: "11:00", checkOut: "14:00" };
    expect(overlaps(a, b)).toBe(true);
  });

  it("non-overlapping slots", () => {
    const a = { checkIn: "09:00", checkOut: "12:00" };
    const b = { checkIn: "12:00", checkOut: "14:00" };
    expect(overlaps(a, b)).toBe(false);
  });

  it("adjacent slots do not overlap", () => {
    const a = { checkIn: "08:00", checkOut: "09:00" };
    const b = { checkIn: "09:00", checkOut: "10:00" };
    expect(overlaps(a, b)).toBe(false);
  });
});
