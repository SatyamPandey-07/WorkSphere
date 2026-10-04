/**
 * Tests for venue booking multi-timezone date/time handling.
 */

interface TimezoneBooking {
  id: string;
  venueTimezone: string;
  guestTimezone: string;
  startUtcMs: number;
  endUtcMs: number;
  durationMs: number;
}

function durationHours(booking: TimezoneBooking): number {
  return Math.round((booking.endUtcMs - booking.startUtcMs) / 3_600_000 * 10) / 10;
}

function isSameDay(ms1: number, ms2: number): boolean {
  const d1 = new Date(ms1);
  const d2 = new Date(ms2);
  return d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate();
}

function isOvernightBooking(booking: TimezoneBooking): boolean {
  return !isSameDay(booking.startUtcMs, booking.endUtcMs);
}

function utcHour(ms: number): number {
  return new Date(ms).getUTCHours();
}

function isBusinessHours(ms: number): boolean {
  const hour = utcHour(ms);
  const dow = new Date(ms).getUTCDay();
  return dow >= 1 && dow <= 5 && hour >= 8 && hour < 18;
}

function bookingSpansWeekend(booking: TimezoneBooking): boolean {
  let cursor = booking.startUtcMs;
  while (cursor <= booking.endUtcMs) {
    const dow = new Date(cursor).getUTCDay();
    if (dow === 0 || dow === 6) return true;
    cursor += 86_400_000;
  }
  return false;
}

function utcToRelativeHours(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / 3_600_000 * 10) / 10;
}

// 2026-11-02 Monday 09:00 UTC
const MONDAY_9AM = 1762074000000;
const HOUR = 3_600_000;

const BOOKING: TimezoneBooking = {
  id: "b1", venueTimezone: "Europe/London", guestTimezone: "America/New_York",
  startUtcMs: MONDAY_9AM,
  endUtcMs:   MONDAY_9AM + 8 * HOUR,
  durationMs: 8 * HOUR,
};

describe("Multi-timezone date/time handling", () => {
  it("durationHours: 8 hour booking", () => {
    expect(durationHours(BOOKING)).toBe(8);
  });

  it("isOvernightBooking: same-day booking → false", () => {
    expect(isOvernightBooking(BOOKING)).toBe(false);
  });

  it("isOvernightBooking: crosses midnight → true", () => {
    const overnight: TimezoneBooking = {
      ...BOOKING,
      startUtcMs: MONDAY_9AM + 16 * HOUR, // 1am next day
      endUtcMs:   MONDAY_9AM + 24 * HOUR,
    };
    expect(isOvernightBooking(overnight)).toBe(true);
  });

  it("isBusinessHours: Monday 9am UTC → true", () => {
    expect(isBusinessHours(MONDAY_9AM)).toBe(true);
  });

  it("isBusinessHours: Sunday → false", () => {
    const sunday = MONDAY_9AM - 86_400_000; // Sunday
    expect(isBusinessHours(sunday)).toBe(false);
  });

  it("utcToRelativeHours: 8h difference", () => {
    expect(utcToRelativeHours(MONDAY_9AM, MONDAY_9AM + 8 * HOUR)).toBe(8);
  });
});
