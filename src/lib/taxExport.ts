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
export function resolveDateRange(input?: {
  taxYear?: string | number | null;
  startDate?: string | null;
  endDate?: string | null;
} | null): DateRange {
  if (!input || typeof input !== "object") {
    throw new Error("Either taxYear or both startDate and endDate are required");
  }

  if (input.taxYear != null && input.taxYear !== "") {
    const year =
      typeof input.taxYear === "number"
        ? input.taxYear
        : Number(String(input.taxYear).trim());
    if (!Number.isInteger(year) || year < 1970 || year > 9999) {
      throw new Error("Invalid tax year");
    }
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }

  if (
    !input.startDate ||
    !input.endDate ||
    typeof input.startDate !== "string" ||
    typeof input.endDate !== "string"
  ) {
    throw new Error("Either taxYear or both startDate and endDate are required");
  }

  const start = input.startDate.trim();
  const end = input.endDate.trim();

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
export function filterBookingsByRange<T extends { date?: string | null }>(
  bookings?: T[] | null,
  range?: DateRange | null,
): T[] {
  if (!Array.isArray(bookings) || !range || !range.start || !range.end) {
    return [];
  }
  return bookings.filter((b) => {
    if (!b || !b.date || typeof b.date !== "string") return false;
    const dateStr = b.date.slice(0, 10);
    return dateStr >= range.start && dateStr <= range.end;
  });
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
  bookings?: ({ duration?: number | null } | null)[] | null,
): TaxTotals {
  if (!Array.isArray(bookings) || bookings.length === 0) {
    return { subtotal: 0, tax: 0, total: 0, count: 0 };
  }

  let subtotal = 0;
  let tax = 0;
  let count = 0;

  for (const b of bookings) {
    if (!b) continue;
    count++;
    const raw = b.duration ?? 1;
    const hours =
      typeof raw === "number" && Number.isFinite(raw)
        ? Math.max(0, raw)
        : !Number.isFinite(raw)
          ? 1
          : 0;
    const price = hours * 15;

    subtotal += price;
    tax += Number((price * 0.08).toFixed(2));
  }

  return {
    subtotal: Number(subtotal.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total: Number((subtotal + tax).toFixed(2)),
    count,
  };
}

/**
 * Builds the tax-export CSV, reusing the existing bookingsToCSV formatter
 * so column formatting/escaping stays consistent with the rest of the app.
 */
export function taxBookingsToCSV(bookings?: ExportableBooking[] | null): string {
  if (!Array.isArray(bookings) || bookings.length === 0) {
    return "";
  }
  return bookingsToCSV(bookings);
}
