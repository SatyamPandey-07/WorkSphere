/**
 * Reservation and Booking Domain Engine.
 *
 * Provides centralized BookingEngine, DateTimeAdapter, and availability/conflict calculators.
 */

export * from "./types";
export * from "./dateTimeAdapter";
export * from "./bookingEngine";

import {
  BookingSlot,
  StoredBookingSlot,
  BookingCancellationEligibility,
  BOOKING_CANCELLATION_WINDOW_HOURS,
  BOOKING_CANCELLATION_WINDOW_MS,
  BOOKING_CANCELLATION_POLICY_MESSAGE,
} from "./types";
import {
  defaultDateTimeAdapter,
  isValidTimeZone,
  normalizeBookingTime,
  isValidBookingDate,
  parseBookingDateTime,
  bookingStartsAt,
  bookingInterval,
  intervalsOverlap,
  conflictDateWindow,
} from "./dateTimeAdapter";
import { globalBookingEngine } from "./bookingEngine";

export {
  BOOKING_CANCELLATION_WINDOW_HOURS,
  BOOKING_CANCELLATION_WINDOW_MS,
  BOOKING_CANCELLATION_POLICY_MESSAGE,
};

/**
 * Functional bridge helper: findConflictingBookings
 */
export function findConflictingBookings<T extends StoredBookingSlot>(
  requested: BookingSlot,
  existing: readonly T[],
): T[] {
  return globalBookingEngine.checkConflicts({
    requestedSlot: requested,
    existingBookings: existing,
  }).conflictingBookings;
}

/**
 * Functional bridge helper: hasBookingConflict
 */
export function hasBookingConflict(
  requested: BookingSlot,
  existing: readonly StoredBookingSlot[],
): boolean {
  return (
    globalBookingEngine.checkConflicts({
      requestedSlot: requested,
      existingBookings: existing,
    }).conflictingBookings.length > 0
  );
}

/**
 * Functional bridge helper: getBookingCancellationEligibility
 */
export function getBookingCancellationEligibility(input: {
  date: string;
  time: string;
  now?: Date;
  timeZone?: string | null;
}): BookingCancellationEligibility {
  return globalBookingEngine.evaluateCancellationEligibility({
    date: input.date,
    time: input.time,
    now: input.now,
    timeZone: input.timeZone,
  });
}

/**
 * Functional bridge helper: cancellationWindowHoursRemaining
 */
export function cancellationWindowHoursRemaining(
  millisecondsUntilStart: number,
): number {
  if (!Number.isFinite(millisecondsUntilStart)) return 0;
  return Math.max(0, millisecondsUntilStart / (60 * 60 * 1000));
}

/**
 * Functional bridge helper: parseBookingStart
 */
export function parseBookingStart(date: string, time: string): Date | null {
  if (!isValidBookingDate(date)) return null;
  const normalized = normalizeBookingTime(time);
  if (!normalized) return null;

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = normalized.split(":").map(Number);

  const bookingStart = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    bookingStart.getFullYear() !== year ||
    bookingStart.getMonth() !== month - 1 ||
    bookingStart.getDate() !== day ||
    bookingStart.getHours() !== hour ||
    bookingStart.getMinutes() !== minute
  ) {
    return null;
  }

  return bookingStart;
}
