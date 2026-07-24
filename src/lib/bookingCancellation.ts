export const BOOKING_CANCELLATION_WINDOW_HOURS = 2;
export const BOOKING_CANCELLATION_WINDOW_MS =
  BOOKING_CANCELLATION_WINDOW_HOURS * 60 * 60 * 1000;

export const BOOKING_CANCELLATION_POLICY_MESSAGE =
  "Bookings can only be cancelled at least 2 hours before the scheduled start time.";

export type BookingCancellationEligibility =
  | {
      allowed: true;
      bookingStart: Date;
      millisecondsUntilStart: number;
    }
  | {
      allowed: false;
      bookingStart: Date | null;
      millisecondsUntilStart: number | null;
      reason:
        "INVALID_START_TIME" | "BOOKING_ALREADY_STARTED" | "INSIDE_WINDOW";
      message: string;
    };

const BOOKING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BOOKING_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Converts the Booking model's YYYY-MM-DD date and HH:mm time fields into a
 * local Date. Booking creation currently stores both values without a timezone,
 * so cancellation checks intentionally follow the same local-time convention.
 */
export function parseBookingStart(date: string, time: string): Date | null {
  if (!BOOKING_DATE_PATTERN.test(date) || !BOOKING_TIME_PATTERN.test(time)) {
    return null;
  }

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  const bookingStart = new Date(year, month - 1, day, hour, minute, 0, 0);

  // Reject impossible dates such as 2026-02-31, which JavaScript normalizes.
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

export function getBookingCancellationEligibility(input: {
  date: string;
  time: string;
  now?: Date;
}): BookingCancellationEligibility {
  const bookingStart = parseBookingStart(input.date, input.time);

  if (!bookingStart) {
    return {
      allowed: false,
      bookingStart: null,
      millisecondsUntilStart: null,
      reason: "INVALID_START_TIME",
      message:
        "The booking start date or time is invalid. Please contact support.",
    };
  }

  const now = input.now ?? new Date();
  const millisecondsUntilStart = bookingStart.getTime() - now.getTime();

  if (millisecondsUntilStart <= 0) {
    return {
      allowed: false,
      bookingStart,
      millisecondsUntilStart,
      reason: "BOOKING_ALREADY_STARTED",
      message:
        "This booking has already started and can no longer be cancelled.",
    };
  }

  if (millisecondsUntilStart < BOOKING_CANCELLATION_WINDOW_MS) {
    return {
      allowed: false,
      bookingStart,
      millisecondsUntilStart,
      reason: "INSIDE_WINDOW",
      message: BOOKING_CANCELLATION_POLICY_MESSAGE,
    };
  }

  return {
    allowed: true,
    bookingStart,
    millisecondsUntilStart,
  };
}

export function cancellationWindowHoursRemaining(
  millisecondsUntilStart: number,
): number {
  return Math.max(0, millisecondsUntilStart / (60 * 60 * 1000));
}
