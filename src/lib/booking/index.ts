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
  parseBookingStart,
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
  const safeExisting = Array.isArray(existing) ? existing : [];
  return globalBookingEngine.checkConflicts({
    requestedSlot: requested,
    existingBookings: safeExisting,
  }).conflictingBookings;
}

/**
 * Functional bridge helper: hasBookingConflict
 */
export function hasBookingConflict(
  requested: BookingSlot,
  existing: readonly StoredBookingSlot[],
): boolean {
  const safeExisting = Array.isArray(existing) ? existing : [];
  return (
    globalBookingEngine.checkConflicts({
      requestedSlot: requested,
      existingBookings: safeExisting,
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
  if (!input || typeof input !== "object") {
    return globalBookingEngine.evaluateCancellationEligibility({
      date: "",
      time: "",
    });
  }
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
export { parseBookingStart };
