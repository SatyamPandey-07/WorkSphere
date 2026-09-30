/**
 * Tests for venue concurrent booking limits and capacity enforcement.
 */

interface SlotBooking {
  bookingId: string;
  venueId: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  seats: number;
}

function bookingsInSlot(
  bookings: SlotBooking[],
  venueId: string,
  date: string,
  minute: number
): SlotBooking[] {
  return bookings.filter(
    (b) =>
      b.venueId === venueId &&
      b.date === date &&
      b.startMinutes <= minute &&
      b.endMinutes > minute
  );
}

function seatsOccupied(
  bookings: SlotBooking[],
  venueId: string,
  date: string,
  minute: number
): number {
  return bookingsInSlot(bookings, venueId, date, minute).reduce(
    (sum, b) => sum + b.seats,
    0
  );
}

function canBook(
  bookings: SlotBooking[],
  venueId: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  seats: number,
  maxCapacity: number
): boolean {
  for (let m = startMinutes; m < endMinutes; m += 30) {
    if (seatsOccupied(bookings, venueId, date, m) + seats > maxCapacity) return false;
  }
  return true;
}

const BOOKINGS: SlotBooking[] = [
  { bookingId: "b1", venueId: "v1", date: "2026-10-01", startMinutes: 540, endMinutes: 660, seats: 5  }, // 9-11am
  { bookingId: "b2", venueId: "v1", date: "2026-10-01", startMinutes: 600, endMinutes: 720, seats: 3  }, // 10am-12pm
];

describe("Venue capacity booking limits", () => {
  it("seatsOccupied at 10am (minute 600): 5+3 = 8", () => {
    expect(seatsOccupied(BOOKINGS, "v1", "2026-10-01", 600)).toBe(8);
  });

  it("seatsOccupied at 9am (minute 540): 5", () => {
    expect(seatsOccupied(BOOKINGS, "v1", "2026-10-01", 540)).toBe(5);
  });

  it("seatsOccupied at 12pm (minute 720): 0", () => {
    expect(seatsOccupied(BOOKINGS, "v1", "2026-10-01", 720)).toBe(0);
  });

  it("canBook: 2 more seats at 10am with capacity 12 → true", () => {
    expect(canBook(BOOKINGS, "v1", "2026-10-01", 600, 660, 2, 12)).toBe(true);
  });

  it("canBook: 5 more seats at 10am with capacity 12 → false", () => {
    expect(canBook(BOOKINGS, "v1", "2026-10-01", 600, 660, 5, 12)).toBe(false);
  });

  it("canBook: all seats in empty slot → true", () => {
    expect(canBook(BOOKINGS, "v1", "2026-10-01", 480, 540, 10, 10)).toBe(true);
  });

  it("seatsOccupied: different date → 0", () => {
    expect(seatsOccupied(BOOKINGS, "v1", "2026-10-02", 600)).toBe(0);
  });
});
