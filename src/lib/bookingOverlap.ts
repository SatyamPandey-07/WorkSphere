/**
 * Seat-booking conflict detection.
 *
 * A booking is stored as a wall-clock date ("YYYY-MM-DD"), a wall-clock time
 * ("HH:mm") and the IANA zone those were chosen in. Venues have no timezone of
 * their own, so that triple is the only thing that pins a booking to a real
 * moment, and two bookings for the same seat conflict only when their real
 * time ranges intersect.
 *
 * Comparing bare "HH:mm" strings within an equal `date` string (what this logic
 * used to do) is wrong in several ways:
 *  - bookings made in different timezones compare as if they were in one zone;
 *  - a booking that runs past midnight never meets one stored under the next
 *    calendar date;
 *  - a zone can shift the calendar date of the very same instant;
 *  - legacy "h:mm AM" times parse to NaN, and every NaN comparison is false, so
 *    those rows silently never conflicted.
 *
 * Everything here works on UTC instants built with `bookingStartsAt`.
 */

import { bookingStartsAt } from "@/lib/bookingTime";

/** Duration assumed for rows that predate the `duration` column. */
export const DEFAULT_BOOKING_DURATION_MINUTES = 60;

/**
 * How many calendar days either side of the requested date a conflicting row
 * can be stored under. Zone offsets span UTC-12..UTC+14, so one instant has
 * wall-clock dates up to a day apart across zones, and a booking lasts at most
 * 8 hours. Brute-forcing those extremes (see bookingOverlap.test.ts) shows a
 * conflicting row is never more than 2 days away; 3 leaves a day of margin for
 * legacy rows with longer durations.
 */
export const CONFLICT_DATE_WINDOW_DAYS = 3;

export interface BookingSlot {
  date: string;
  time: string;
  timeZone?: string | null;
  duration?: number | null;
}

/**
 * A row as read back from the database. `date` may be omitted (it then means
 * "the requested date") so callers that already filtered by date keep working.
 */
export type StoredBookingSlot = Omit<BookingSlot, "date"> & { date?: string };

export interface BookingInterval {
  /** Inclusive start, ms since epoch. */
  start: number;
  /** Exclusive end, ms since epoch. */
  end: number;
}

/** The real time range a slot occupies, or null when its date/time can't be parsed. */
export function bookingInterval(
  slot: BookingSlot,
  fallbackTimeZone?: string | null,
): BookingInterval | null {
  const startsAt = bookingStartsAt(slot, fallbackTimeZone);
  if (!startsAt) return null;

  const minutes =
    typeof slot.duration === "number" &&
    Number.isFinite(slot.duration) &&
    slot.duration > 0
      ? slot.duration
      : DEFAULT_BOOKING_DURATION_MINUTES;

  const start = startsAt.getTime();
  return { start, end: start + minutes * 60_000 };
}

/** Half-open interval intersection: back-to-back bookings do not conflict. */
export function intervalsOverlap(a: BookingInterval, b: BookingInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Every "YYYY-MM-DD" a conflicting booking could be stored under, for use in a
 * `date: { in: [...] }` query. Includes `date` itself.
 */
export function conflictDateWindow(
  date: string,
  radiusDays: number = CONFLICT_DATE_WINDOW_DAYS,
): string[] {
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
 * The stored rows whose real time range intersects the requested slot.
 *
 * Rows without a timeZone (created before the column existed) are read in the
 * requested slot's zone, which is exactly how they were compared before, so
 * their behaviour is unchanged. Rows whose date/time can't be parsed at all are
 * skipped, because there's nothing meaningful to compare.
 */
export function findConflictingBookings<T extends StoredBookingSlot>(
  requested: BookingSlot,
  existing: readonly T[],
): T[] {
  const requestedInterval = bookingInterval(requested);
  if (!requestedInterval) {
    throw new Error("findConflictingBookings: requested slot has an invalid date or time");
  }
  const fallbackZone = requested.timeZone || "UTC";

  return existing.filter((row) => {
    const rowInterval = bookingInterval(
      { ...row, date: row.date ?? requested.date },
      fallbackZone,
    );
    return rowInterval !== null && intervalsOverlap(rowInterval, requestedInterval);
  });
}

export function hasBookingConflict(
  requested: BookingSlot,
  existing: readonly StoredBookingSlot[],
): boolean {
  return findConflictingBookings(requested, existing).length > 0;
}
