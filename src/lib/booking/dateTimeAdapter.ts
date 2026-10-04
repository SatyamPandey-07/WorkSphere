/**
 * Consistent Date/Time and Timezone Adapter for Booking Domain.
 *
 * Provides accurate wall-clock to UTC instant conversions, robust DST transition handling,
 * IANA timezone validation, and interval calculations.
 */

import {
  BookingInterval,
  BookingSlot,
} from "./types";

export interface DateTimeAdapter {
  isValidTimeZone(timeZone: unknown): timeZone is string;
  normalizeBookingTime(time: string): string | null;
  isValidBookingDate(date: string): boolean;
  parseBookingDateTime(
    dateStr: string,
    timeStr: string,
    timeZone?: string,
  ): Date | null;
  bookingStartsAt(
    booking: { date: string; time: string; timeZone?: string | null },
    fallbackTimeZone?: string | null,
  ): Date | null;
  timeZoneOffsetMs(instant: Date, timeZone: string): number;
  formatToWallClock(
    instant: Date,
    timeZone: string,
  ): { date: string; time: string };
  bookingInterval(
    slot: BookingSlot,
    fallbackTimeZone?: string | null,
    defaultDurationMinutes?: number,
  ): BookingInterval | null;
  intervalsOverlap(a: BookingInterval, b: BookingInterval): boolean;
  conflictDateWindow(date: string, radiusDays?: number): string[];
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes "9:05", "09:05" or "9:05 AM" to 24-hour "HH:mm"; returns null if invalid.
 */
export function normalizeBookingTime(time: string): string | null {
  const value = time?.trim() ?? "";
  let hours: number;
  let minutes: number;

  const twelveHour = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const twentyFourHour = value.match(/^(\d{1,2}):(\d{2})$/);
  if (twelveHour) {
    hours = parseInt(twelveHour[1], 10);
    minutes = parseInt(twelveHour[2], 10);
    if (hours < 1 || hours > 12) return null;
    const isPm = twelveHour[3].toUpperCase() === "PM";
    if (hours === 12) hours = isPm ? 12 : 0;
    else if (isPm) hours += 12;
  } else if (twentyFourHour) {
    hours = parseInt(twentyFourHour[1], 10);
    minutes = parseInt(twentyFourHour[2], 10);
    if (hours > 23) return null;
  } else {
    return null;
  }
  if (minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Returns true for a valid calendar date in "YYYY-MM-DD" format.
 */
export function isValidBookingDate(date: string): boolean {
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * Calculates the offset in milliseconds of `timeZone` relative to UTC at `instant`.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => {
    const val = parts.find((p) => p.type === type)?.value ?? "0";
    const num = Number(val);
    if (type === "hour" && num === 24) return 0;
    return num;
  };
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  // Compare at second precision to prevent sub-second jitter
  const instantSecondsMs = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - instantSecondsMs;
}

/**
 * Parses a booking's date and time as wall-clock time in `timeZone` and
 * returns the corresponding instant, or null when either part is invalid.
 * Uses iterative offset convergence to accurately account for Daylight Saving Time (DST) shifts.
 */
export function parseBookingDateTime(
  dateStr: string,
  timeStr: string,
  timeZone: string = "UTC",
): Date | null {
  if (!isValidBookingDate(dateStr)) return null;
  const time = normalizeBookingTime(timeStr);
  if (!time) return null;

  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";

  // Iterative offset convergence for exact DST transition shift handling
  let instant =
    wallClockAsUtc - timeZoneOffsetMs(new Date(wallClockAsUtc), zone);
  for (let i = 0; i < 4; i++) {
    const offset = timeZoneOffsetMs(new Date(instant), zone);
    const nextInstant = wallClockAsUtc - offset;
    if (nextInstant === instant) break;
    instant = nextInstant;
  }

  const result = new Date(instant);
  return isNaN(result.getTime()) ? null : result;
}

/**
 * Start instant of a stored booking, preferring its own timezone.
 */
export function bookingStartsAt(
  booking: { date: string; time: string; timeZone?: string | null },
  fallbackTimeZone?: string | null,
): Date | null {
  return parseBookingDateTime(
    booking.date,
    booking.time,
    booking.timeZone || fallbackTimeZone || "UTC",
  );
}

/**
 * Converts a UTC instant into wall-clock date and time in target timeZone.
 */
export function formatToWallClock(
  instant: Date,
  timeZone: string = "UTC",
): { date: string; time: string } {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const minute = get("minute");
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  return { date, time };
}

/**
 * Computes the epoch millisecond interval for a booking slot.
 */
export function bookingInterval(
  slot: BookingSlot,
  fallbackTimeZone?: string | null,
  defaultDurationMinutes: number = 60,
): BookingInterval | null {
  const startsAt = bookingStartsAt(slot, fallbackTimeZone);
  if (!startsAt) return null;

  const minutes =
    typeof slot.duration === "number" &&
    Number.isFinite(slot.duration) &&
    slot.duration > 0
      ? slot.duration
      : defaultDurationMinutes;

  const start = startsAt.getTime();
  return { start, end: start + minutes * 60_000 };
}

/**
 * Half-open interval intersection test: [start, end)
 * Back-to-back bookings do not conflict.
 */
export function intervalsOverlap(
  a: BookingInterval,
  b: BookingInterval,
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Returns all dates ("YYYY-MM-DD") within radiusDays of date.
 */
export function conflictDateWindow(
  date: string,
  radiusDays: number = 3,
): string[] {
  if (!isValidBookingDate(date)) return [];
  const [y, m, d] = date.split("-").map(Number);
  const dates: string[] = [];
  for (let offset = -radiusDays; offset <= radiusDays; offset++) {
    dates.push(
      new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10),
    );
  }
  return dates;
}

/**
 * Default implementation of DateTimeAdapter interface.
 */
export class BookingDateTimeAdapter implements DateTimeAdapter {
  isValidTimeZone(timeZone: unknown): timeZone is string {
    return isValidTimeZone(timeZone);
  }

  normalizeBookingTime(time: string): string | null {
    return normalizeBookingTime(time);
  }

  isValidBookingDate(date: string): boolean {
    return isValidBookingDate(date);
  }

  parseBookingDateTime(
    dateStr: string,
    timeStr: string,
    timeZone?: string,
  ): Date | null {
    return parseBookingDateTime(dateStr, timeStr, timeZone);
  }

  bookingStartsAt(
    booking: { date: string; time: string; timeZone?: string | null },
    fallbackTimeZone?: string | null,
  ): Date | null {
    return bookingStartsAt(booking, fallbackTimeZone);
  }

  timeZoneOffsetMs(instant: Date, timeZone: string): number {
    return timeZoneOffsetMs(instant, timeZone);
  }

  formatToWallClock(
    instant: Date,
    timeZone: string,
  ): { date: string; time: string } {
    return formatToWallClock(instant, timeZone);
  }

  bookingInterval(
    slot: BookingSlot,
    fallbackTimeZone?: string | null,
    defaultDurationMinutes?: number,
  ): BookingInterval | null {
    return bookingInterval(slot, fallbackTimeZone, defaultDurationMinutes);
  }

  intervalsOverlap(a: BookingInterval, b: BookingInterval): boolean {
    return intervalsOverlap(a, b);
  }

  conflictDateWindow(date: string, radiusDays?: number): string[] {
    return conflictDateWindow(date, radiusDays);
  }
}

export const defaultDateTimeAdapter = new BookingDateTimeAdapter();
