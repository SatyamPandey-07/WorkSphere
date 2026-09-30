/**
 * Tests for venue meeting room scheduler with recurring and one-off bookings.
 */

interface RoomBooking {
  bookingId: string;
  roomId: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  isRecurring: boolean;
  recurringDayOfWeek?: number;
  organizer: string;
  attendees: string[];
}

function hasConflict(a: RoomBooking, b: RoomBooking): boolean {
  if (a.roomId !== b.roomId || a.date !== b.date) return false;
  return a.startMinutes < b.endMinutes && a.endMinutes > b.startMinutes;
}

function bookingsForRoom(bookings: RoomBooking[], roomId: string, date: string): RoomBooking[] {
  return bookings
    .filter((b) => b.roomId === roomId && b.date === date)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

function nextAvailableSlot(
  bookings: RoomBooking[],
  roomId: string,
  date: string,
  durationMinutes: number,
  openMinutes = 480,
  closeMinutes = 1200
): { startMinutes: number; endMinutes: number } | null {
  const dayBookings = bookingsForRoom(bookings, roomId, date);
  let current = openMinutes;

  for (const booking of dayBookings) {
    if (booking.startMinutes - current >= durationMinutes) {
      return { startMinutes: current, endMinutes: current + durationMinutes };
    }
    current = Math.max(current, booking.endMinutes);
  }

  // Check after last booking
  if (current + durationMinutes <= closeMinutes) {
    return { startMinutes: current, endMinutes: current + durationMinutes };
  }

  return null;
}

function totalBookedMinutes(bookings: RoomBooking[], roomId: string, date: string): number {
  return bookingsForRoom(bookings, roomId, date).reduce(
    (sum, b) => sum + (b.endMinutes - b.startMinutes), 0
  );
}

const BOOKINGS: RoomBooking[] = [
  { bookingId: "b1", roomId: "r1", date: "2026-10-01", startMinutes: 540,  endMinutes: 660,  isRecurring: false, organizer: "u1", attendees: ["u1", "u2"] },
  { bookingId: "b2", roomId: "r1", date: "2026-10-01", startMinutes: 720,  endMinutes: 840,  isRecurring: false, organizer: "u3", attendees: ["u3"] },
  { bookingId: "b3", roomId: "r2", date: "2026-10-01", startMinutes: 540,  endMinutes: 720,  isRecurring: false, organizer: "u4", attendees: ["u4"] },
];

describe("Venue meeting room scheduler", () => {
  it("hasConflict: same room overlapping times → true", () => {
    const overlap: RoomBooking = { bookingId: "x", roomId: "r1", date: "2026-10-01", startMinutes: 600, endMinutes: 750, isRecurring: false, organizer: "u5", attendees: [] };
    expect(hasConflict(BOOKINGS[0], overlap)).toBe(true);
  });

  it("hasConflict: different rooms → false", () => {
    expect(hasConflict(BOOKINGS[0], BOOKINGS[2])).toBe(false);
  });

  it("bookingsForRoom: r1 Oct 1 = 2 sorted bookings", () => {
    const roomBookings = bookingsForRoom(BOOKINGS, "r1", "2026-10-01");
    expect(roomBookings).toHaveLength(2);
    expect(roomBookings[0].startMinutes).toBeLessThan(roomBookings[1].startMinutes);
  });

  it("nextAvailableSlot: 60 min slot between bookings", () => {
    const slot = nextAvailableSlot(BOOKINGS, "r1", "2026-10-01", 60);
    expect(slot).not.toBeNull();
  });

  it("nextAvailableSlot: before first booking (480-540 = 60 min)", () => {
    const slot = nextAvailableSlot(BOOKINGS, "r1", "2026-10-01", 60);
    expect(slot!.startMinutes).toBe(480); // opens at 8am, first booking at 9am
  });

  it("totalBookedMinutes: r1 = 120+120 = 240", () => {
    expect(totalBookedMinutes(BOOKINGS, "r1", "2026-10-01")).toBe(240);
  });
});
