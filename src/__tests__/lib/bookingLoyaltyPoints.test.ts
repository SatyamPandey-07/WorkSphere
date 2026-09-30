/**
 * Tests for loyalty points earned from bookings.
 */

type BookingType = "hot_desk" | "dedicated_desk" | "private_office" | "meeting_room";

const POINTS_PER_DOLLAR: Record<BookingType, number> = {
  hot_desk:        1,
  dedicated_desk:  2,
  private_office:  3,
  meeting_room:    2,
};

interface BookingLoyalty {
  bookingId: string;
  userId: string;
  type: BookingType;
  totalCents: number;
  bonusMultiplier: number; // 1.0 = normal, 2.0 = double points
}

function basePoints(booking: BookingLoyalty): number {
  const dollars = Math.floor(booking.totalCents / 100);
  return dollars * POINTS_PER_DOLLAR[booking.type];
}

function earnedPoints(booking: BookingLoyalty): number {
  return Math.round(basePoints(booking) * booking.bonusMultiplier);
}

function totalEarnedFromBookings(bookings: BookingLoyalty[]): number {
  return bookings.reduce((sum, b) => sum + earnedPoints(b), 0);
}

function pointsForBookingType(
  bookings: BookingLoyalty[],
  userId: string,
  type: BookingType
): number {
  return bookings
    .filter((b) => b.userId === userId && b.type === type)
    .reduce((sum, b) => sum + earnedPoints(b), 0);
}

const BOOKINGS: BookingLoyalty[] = [
  { bookingId: "b1", userId: "u1", type: "hot_desk",       totalCents: 5000, bonusMultiplier: 1.0 }, // $50 × 1 = 50 pts
  { bookingId: "b2", userId: "u1", type: "dedicated_desk", totalCents: 8000, bonusMultiplier: 2.0 }, // $80 × 2 × 2 = 320 pts
  { bookingId: "b3", userId: "u2", type: "private_office", totalCents: 20000, bonusMultiplier: 1.0}, // $200 × 3 = 600 pts
];

describe("Booking loyalty points", () => {
  it("basePoints: $50 hot_desk × 1pt = 50", () => {
    expect(basePoints(BOOKINGS[0])).toBe(50);
  });

  it("earnedPoints: bonus multiplier doubles points", () => {
    expect(earnedPoints(BOOKINGS[1])).toBe(320);
  });

  it("earnedPoints: no bonus", () => {
    expect(earnedPoints(BOOKINGS[0])).toBe(50);
  });

  it("totalEarnedFromBookings: 50 + 320 + 600 = 970", () => {
    expect(totalEarnedFromBookings(BOOKINGS)).toBe(970);
  });

  it("pointsForBookingType: u1 hot_desk = 50", () => {
    expect(pointsForBookingType(BOOKINGS, "u1", "hot_desk")).toBe(50);
  });

  it("pointsForBookingType: u1 dedicated_desk = 320", () => {
    expect(pointsForBookingType(BOOKINGS, "u1", "dedicated_desk")).toBe(320);
  });

  it("pointsForBookingType: u1 private_office = 0 (no bookings)", () => {
    expect(pointsForBookingType(BOOKINGS, "u1", "private_office")).toBe(0);
  });
});
