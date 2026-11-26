import {
  generateBookingIcs,
  type BookingCalendarInput,
} from "@/lib/calendar/icsGenerator";

export type BookingDetails = BookingCalendarInput;

export function generateIcsFile(booking: BookingDetails): string {
  const content = generateBookingIcs(booking);
  if (!content) {
    throw new RangeError("Cannot generate a calendar invite for an invalid booking date or time.");
  }
  return content;
}
