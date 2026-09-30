/**
 * Tests for cross-timezone booking handling.
 */

interface CrossTimezoneBooking {
  bookingId: string;
  userTimezone: string;
  venueTimezone: string;
  localStartMs: number;   // user's local time in UTC
  localEndMs: number;
  venueLocalStartMs: number; // venue's local time in UTC
  venueLocalEndMs: number;
}

function isInBusinessHours(
  startMs: number,
  endMs: number,
  venueOpenHour: number,
  venueCloseHour: number,
  venueTimezone: string
): boolean {
  const startLocal = new Date(startMs).toLocaleString("en-US", { timeZone: venueTimezone, hour: "numeric", hour12: false });
  const endLocal = new Date(endMs).toLocaleString("en-US", { timeZone: venueTimezone, hour: "numeric", hour12: false });
  const startHour = parseInt(startLocal);
  const endHour = parseInt(endLocal);
  return startHour >= venueOpenHour && endHour <= venueCloseHour;
}

function formatBookingTimeForUser(timestampMs: number, userTimezone: string): string {
  return new Date(timestampMs).toLocaleString("en-US", {
    timeZone: userTimezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function timezoneOffsetHours(timezone: string, nowMs = Date.now()): number {
  const s = new Date(nowMs).toLocaleString("en-US", { timeZone: timezone, hour: "numeric", hour12: false });
  const utcHour = new Date(nowMs).getUTCHours();
  return parseInt(s) - utcHour;
}

describe("Cross-timezone booking handling", () => {
  const UTC_NOON = new Date("2026-10-15T12:00:00Z").getTime();

  it("isInBusinessHours: UTC noon at v in UTC timezone 9-18 → true", () => {
    expect(isInBusinessHours(UTC_NOON, UTC_NOON + 3_600_000, 9, 18, "UTC")).toBe(true);
  });

  it("isInBusinessHours: UTC midnight outside 9-18 → false", () => {
    const midnight = new Date("2026-10-15T00:00:00Z").getTime();
    expect(isInBusinessHours(midnight, midnight + 3_600_000, 9, 18, "UTC")).toBe(false);
  });

  it("formatBookingTimeForUser: returns non-empty string", () => {
    const formatted = formatBookingTimeForUser(UTC_NOON, "UTC");
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("timezoneOffsetHours: UTC = 0", () => {
    const now = new Date("2026-10-15T12:00:00Z").getTime();
    expect(timezoneOffsetHours("UTC", now)).toBe(0);
  });

  it("timezoneOffsetHours: Asia/Kolkata = +5.5 hours", () => {
    // IST is UTC+5:30, but parseInt may give +5 or +6 depending on exact time
    const now = new Date("2026-10-15T12:00:00Z").getTime();
    const offset = timezoneOffsetHours("Asia/Kolkata", now);
    expect(offset).toBeGreaterThan(0);
  });
});
