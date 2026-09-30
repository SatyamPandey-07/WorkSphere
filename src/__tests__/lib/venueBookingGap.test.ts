/**
 * Tests for booking gap enforcement (minimum time between bookings).
 */

interface Booking {
  bookingId: string;
  venueId: string;
  startMs: number;
  endMs: number;
  seatId: string;
}

function bookingGapMs(a: Booking, b: Booking): number {
  if (a.seatId !== b.seatId) return Infinity;
  const [first, second] = a.endMs <= b.startMs ? [a, b] : [b, a];
  return second.startMs - first.endMs;
}

function hasMinimumGap(
  existing: Booking[],
  newBooking: Booking,
  minGapMs: number
): boolean {
  for (const b of existing) {
    if (b.seatId !== newBooking.seatId || b.bookingId === newBooking.bookingId) continue;
    const gap = bookingGapMs(b, newBooking);
    if (gap !== Infinity && gap < minGapMs) return false;
  }
  return true;
}

function nextAvailableTime(
  lastBooking: Booking,
  minGapMs: number
): number {
  return lastBooking.endMs + minGapMs;
}

const NOW = 1_700_000_000_000;
const BOOKINGS: Booking[] = [
  { bookingId: "b1", venueId: "v1", seatId: "s1", startMs: NOW,            endMs: NOW + 3_600_000 }, // 9-10am
  { bookingId: "b2", venueId: "v1", seatId: "s1", startMs: NOW + 5_400_000, endMs: NOW + 7_200_000 }, // 10:30-11am (gap: 30min)
  { bookingId: "b3", venueId: "v1", seatId: "s2", startMs: NOW,            endMs: NOW + 3_600_000 }, // different seat
];

describe("Booking gap enforcement", () => {
  it("bookingGapMs: 30min gap between b1 and b2 on same seat", () => {
    expect(bookingGapMs(BOOKINGS[0], BOOKINGS[1])).toBe(1_800_000);
  });

  it("bookingGapMs: different seats → Infinity", () => {
    expect(bookingGapMs(BOOKINGS[0], BOOKINGS[2])).toBe(Infinity);
  });

  it("hasMinimumGap: 15min min gap with 30min actual → true", () => {
    const newBooking: Booking = { bookingId: "b4", venueId: "v1", seatId: "s1", startMs: NOW + 4_500_000, endMs: NOW + 5_400_000 };
    expect(hasMinimumGap(BOOKINGS, newBooking, 15 * 60_000)).toBe(true);
  });

  it("hasMinimumGap: 60min min gap with 30min actual → false", () => {
    const tooClose: Booking = { bookingId: "b5", venueId: "v1", seatId: "s1", startMs: NOW + 4_500_000, endMs: NOW + 5_400_000 };
    expect(hasMinimumGap(BOOKINGS, tooClose, 60 * 60_000)).toBe(false);
  });

  it("hasMinimumGap: different seat ignores gap → true", () => {
    const otherSeat: Booking = { bookingId: "b6", venueId: "v1", seatId: "s2", startMs: NOW + 1000, endMs: NOW + 2000 };
    expect(hasMinimumGap(BOOKINGS, otherSeat, 3_600_000)).toBe(true);
  });

  it("nextAvailableTime: after b1 with 30min gap", () => {
    expect(nextAvailableTime(BOOKINGS[0], 30 * 60_000)).toBe(NOW + 3_600_000 + 1_800_000);
  });
});
