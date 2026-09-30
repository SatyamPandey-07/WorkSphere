/**
 * Tests for multi-day venue booking management.
 */

interface MultiDayBooking {
  bookingId: string;
  userId: string;
  venueId: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;
  dailyRateCents: number;
  weekendRateCents: number;
  includedDays: string[]; // specific dates included
  excludedDates: string[]; // holidays/closures
}

function countWeekendDays(startDate: string, endDate: string): number {
  let count = 0;
  const current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    const day = current.getUTCDay();
    if (day === 0 || day === 6) count++;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

function countBookingDays(booking: MultiDayBooking): number {
  const start = new Date(booking.startDate);
  const end = new Date(booking.endDate);
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    if (!booking.excludedDates.includes(dateStr)) count++;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

function totalMultiDayCost(booking: MultiDayBooking): number {
  const start = new Date(booking.startDate);
  const end = new Date(booking.endDate);
  let total = 0;
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    if (!booking.excludedDates.includes(dateStr)) {
      const isWeekend = current.getUTCDay() === 0 || current.getUTCDay() === 6;
      total += isWeekend ? booking.weekendRateCents : booking.dailyRateCents;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return total;
}

const BOOKING: MultiDayBooking = {
  bookingId: "mdb1", userId: "u1", venueId: "v1",
  startDate: "2026-10-05", endDate: "2026-10-09", // Mon-Fri (5 days)
  dailyRateCents: 2000, weekendRateCents: 2500,
  includedDays: [], excludedDates: [],
};

describe("Multi-day venue booking", () => {
  it("countWeekendDays: Mon-Fri has 0 weekend days", () => {
    expect(countWeekendDays("2026-10-05", "2026-10-09")).toBe(0);
  });

  it("countWeekendDays: Mon-Sun has 2 weekend days", () => {
    expect(countWeekendDays("2026-10-05", "2026-10-11")).toBe(2);
  });

  it("countBookingDays: Mon-Fri = 5 days", () => {
    expect(countBookingDays(BOOKING)).toBe(5);
  });

  it("countBookingDays: excludes specific dates", () => {
    const withExclusion = { ...BOOKING, excludedDates: ["2026-10-07"] };
    expect(countBookingDays(withExclusion)).toBe(4);
  });

  it("totalMultiDayCost: 5 weekdays × 2000 = 10000", () => {
    expect(totalMultiDayCost(BOOKING)).toBe(10_000);
  });

  it("totalMultiDayCost: with weekend days", () => {
    const withWeekend = { ...BOOKING, endDate: "2026-10-11" }; // Mon-Sun
    const cost = totalMultiDayCost(withWeekend);
    expect(cost).toBeGreaterThan(10_000); // weekend adds extra
  });
});
