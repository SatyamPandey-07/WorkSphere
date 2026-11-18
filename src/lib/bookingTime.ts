/**
 * Booking dates/times timezone helpers and validation.
 *
 * Re-exports consolidated date/time adapter implementations from @/lib/booking.
 */

import { isValidTimeZone } from "./booking/dateTimeAdapter";

export {
  isValidTimeZone,
  normalizeBookingTime,
  isValidBookingDate,
  timeZoneOffsetMs,
  parseBookingDateTime,
  bookingStartsAt,
} from "./booking/dateTimeAdapter";

/** Today's date ("YYYY-MM-DD") as seen in `timeZone`. */
export function todayInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
