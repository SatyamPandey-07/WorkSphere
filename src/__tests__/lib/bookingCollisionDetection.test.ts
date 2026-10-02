/**
 * Tests for booking collision/conflict detection.
 * Two bookings conflict if they share venueId + date + time.
 */

interface Booking {
  id: string;
  venueId: string;
  date: string;
  time: string;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
}

function hasConflict(
  existingBookings: Booking[],
  venueId: string,
  date: string,
  time: string,
): boolean {
  return existingBookings.some(
    (b) =>
      b.venueId === venueId &&
      b.date === date &&
      b.time === time &&
      b.status !== "CANCELLED",
  );
}

const EXISTING: Booking[] = [
  { id: "b1", venueId: "v1", date: "2026-10-01", time: "10:00 AM", status: "CONFIRMED" },
  { id: "b2", venueId: "v1", date: "2026-10-01", time: "02:00 PM", status: "CONFIRMED" },
  { id: "b3", venueId: "v1", date: "2026-10-02", time: "10:00 AM", status: "CANCELLED" },
];

describe("Booking collision detection", () => {
  it("detects conflict with same venue+date+time", () => {
    expect(hasConflict(EXISTING, "v1", "2026-10-01", "10:00 AM")).toBe(true);
  });

  it("no conflict with different time", () => {
    expect(hasConflict(EXISTING, "v1", "2026-10-01", "11:00 AM")).toBe(false);
  });

  it("no conflict with different date", () => {
    expect(hasConflict(EXISTING, "v1", "2026-10-03", "10:00 AM")).toBe(false);
  });

  it("no conflict with different venue", () => {
    expect(hasConflict(EXISTING, "v2", "2026-10-01", "10:00 AM")).toBe(false);
  });

  it("cancelled booking does NOT create conflict", () => {
    expect(hasConflict(EXISTING, "v1", "2026-10-02", "10:00 AM")).toBe(false);
  });

  it("no conflict with empty bookings list", () => {
    expect(hasConflict([], "v1", "2026-10-01", "10:00 AM")).toBe(false);
  });

  it("detects second conflicting slot", () => {
    expect(hasConflict(EXISTING, "v1", "2026-10-01", "02:00 PM")).toBe(true);
  });
});
