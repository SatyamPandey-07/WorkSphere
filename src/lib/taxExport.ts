import { ExportableBooking, bookingsToCSV } from "@/lib/pdfHelpers";

export interface TaxExportBooking extends ExportableBooking {
  userId?: string;
}

export interface DateRange {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
}

/**
 * Resolves either a tax year or an explicit start/end into a concrete date range.
 * taxYear takes precedence if both are somehow provided.
 */
export function resolveDateRange(input: {
  taxYear?: string | number;
  startDate?: string;
  endDate?: string;
}): DateRange {
  if (input.taxYear) {
    const year = Number(input.taxYear);
    if (!Number.isInteger(year) || year < 1970 || year > 9999) {
      throw new Error("Invalid tax year");
    }
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }

  if (!input.startDate || !input.endDate) {
    throw new Error("Either taxYear or both startDate and endDate are required");
  }

  const start = input.startDate;
  const end = input.endDate;

  if (isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
    throw new Error("startDate/endDate must be valid dates");
  }
  if (start > end) {
    throw new Error("startDate must be before endDate");
  }

  return { start, end };
}

/**
 * Filters bookings whose `date` (YYYY-MM-DD string) falls within [range.start, range.end] inclusive.
 * String comparison works correctly here because YYYY-MM-DD sorts lexicographically same as chronologically.
 */
export function filterBookingsByRange<T extends { date: string }>(
  bookings: T[],
  range: DateRange,
): T[] {
  return bookings.filter((b) => b.date >= range.start && b.date <= range.end);
}

export interface TaxTotals {
  subtotal: number;
  tax: number;
  total: number;
  count: number;
}

/**
 * Computes totals using the same flat-rate assumption used elsewhere in the codebase
 * ($15/hr, 8% flat tax) until real price/tax fields exist on Booking.
 */
export function computeTaxTotals(
  bookings: { duration?: number | null }[],
): TaxTotals {
  let subtotal = 0;
  let tax = 0;

  for (const b of bookings) {
    const hours = b.duration || 1;
    const price = hours * 15;
    subtotal += price;
    tax += Number((price * 0.08).toFixed(2));
  }

  return {
    subtotal: Number(subtotal.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total: Number((subtotal + tax).toFixed(2)),
    count: bookings.length,
  };
}

/**
 * Builds the tax-export CSV, reusing the existing bookingsToCSV formatter
 * so column formatting/escaping stays consistent with the rest of the app.
 */
export function taxBookingsToCSV(bookings: ExportableBooking[]): string {
  return bookingsToCSV(bookings);
}