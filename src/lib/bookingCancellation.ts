/**
 * Booking cancellation policy and window eligibility.
 *
 * Re-exports consolidated cancellation logic from @/lib/booking.
 */

export {
  BOOKING_CANCELLATION_WINDOW_HOURS,
  BOOKING_CANCELLATION_WINDOW_MS,
  BOOKING_CANCELLATION_POLICY_MESSAGE,
  type BookingCancellationEligibility,
  parseBookingStart,
  getBookingCancellationEligibility,
  cancellationWindowHoursRemaining,
} from "./booking";
