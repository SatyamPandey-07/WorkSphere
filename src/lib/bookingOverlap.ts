/**
 * Seat-booking conflict detection and interval utilities.
 *
 * Re-exports consolidated conflict detection from @/lib/booking.
 */

export {
  type BookingSlot,
  type StoredBookingSlot,
  type BookingInterval,
  DEFAULT_BOOKING_DURATION_MINUTES,
  CONFLICT_DATE_WINDOW_DAYS,
  bookingInterval,
  intervalsOverlap,
  conflictDateWindow,
  findConflictingBookings,
  hasBookingConflict,
} from "./booking";

export const DEFAULT_BOOKING_DURATION_MINUTES = 60;
export const CONFLICT_DATE_WINDOW_DAYS = 3;
