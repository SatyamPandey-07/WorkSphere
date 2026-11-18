/**
 * Tax & Expense Exporter (CSV and PDF).
 *
 * Consolidates tax summary calculations, date range resolution, CSV export,
 * and multi-page expense summary PDF generation.
 */

import { CsvBuilder, escapeCSVField } from "../csvBuilder";
import {
  PdfDocumentBuilder,
  drawSafeText,
  safeText,
  sanitizeMathSymbols,
} from "../pdfBuilder";
import { rgb, breakTextIntoLines } from "pdf-lib";

export interface ExportableBooking {
  id: string;
  confirmationId: string;
  date: string;
  time: string;
  duration?: number | null;
  projectBillingCode?: string | null;
  venue: {
    name: string;
    category: string;
    address: string | null;
  };
}

export interface TaxExportBooking extends ExportableBooking {
  userId?: string;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

export interface TaxTotals {
  subtotal: number;
  tax: number;
  total: number;
  count: number;
}

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

export function bookingsToCSV(bookings?: ExportableBooking[] | null): string {
  if (!Array.isArray(bookings) || bookings.length === 0) {
    return "";
  }
  const safeBookings = bookings.filter((b): b is ExportableBooking => Boolean(b && typeof b === "object"));
  const builder = new CsvBuilder<ExportableBooking>({ lineDelimiter: "\r\n" });

  builder.setColumns([
    {
      header: "Confirmation ID",
      accessor: (b) => b.confirmationId || (b.id ? `WS-#${b.id}` : "WS-#N/A"),
    },
    { header: "Venue", accessor: (b) => b.venue?.name || "" },
    { header: "Category", accessor: (b) => b.venue?.category || "" },
    { header: "Address", accessor: (b) => b.venue?.address || "" },
    { header: "Date", accessor: (b) => b.date },
    { header: "Time", accessor: (b) => b.time },
    {
      header: "Billing Code",
      accessor: (b) => b.projectBillingCode || "N/A",
    },
    {
      header: "Price ($)",
      accessor: (b) => {
        const raw = b.duration !== null && b.duration !== undefined ? Number(b.duration) : 60;
        const minutes = Number.isFinite(raw) && raw >= 0 ? raw : 60;
        const hours = minutes / 60;
        return (hours * 15).toFixed(2);
      },
    },
    {
      header: "Tax ($)",
      accessor: (b) => {
        const raw = b.duration !== null && b.duration !== undefined ? Number(b.duration) : 60;
        const minutes = Number.isFinite(raw) && raw >= 0 ? raw : 60;
        const hours = minutes / 60;
        const price = hours * 15;
        return (price * 0.08).toFixed(2);
      },
    },
    {
      header: "Total ($)",
      accessor: (b) => {
        const raw = b.duration !== null && b.duration !== undefined ? Number(b.duration) : 60;
        const minutes = Number.isFinite(raw) && raw >= 0 ? raw : 60;
        const hours = minutes / 60;
        const price = hours * 15;
        const tax = Number((price * 0.08).toFixed(2));
        return (price + tax).toFixed(2);
      },
    },
  ]);

  builder.addRows(safeBookings);
  return builder.build();
}

export function taxBookingsToCSV(bookings?: ExportableBooking[] | null): string {
  return bookingsToCSV(bookings);
}

/**
 * Exports booking data as formatted JSON.
 */
export function exportBookingsToJson(
  bookings?: ExportableBooking[] | null,
): string {
  if (!Array.isArray(bookings)) return "[]";
  return JSON.stringify(bookings, null, 2);
}

export async function generateTaxExportPdf(
  bookings?: any[] | null,
): Promise<Uint8Array> {
  const safeBookings = Array.isArray(bookings)
    ? bookings.filter((b): b is any => Boolean(b && typeof b === "object"))
    : [];

  const builder = await PdfDocumentBuilder.create({
    accentColor: { r: 0.23, g: 0.51, b: 0.96 },
    margin: 50,
    title: "WorkSphere Expense Summary",
  });

  const { boldFont, font } = builder;

  // Header
  builder.drawHeading(
    "WORKSPHERE EXPENSE SUMMARY",
    "BOOKING HISTORY EXPORT  ·  ESTIMATE ONLY ($15/HR FLAT RATE, 8% TAX)",
    { titleSize: 18, color: rgb(0.1, 0.1, 0.1) },
  );

  const totals = computeTaxTotals(safeBookings);

  builder.drawText(`TOTAL BOOKINGS: ${totals.count}`, {
    size: 11,
    font: boldFont,
  });

  builder.drawText(
    `SUBTOTAL: $${totals.subtotal.toFixed(2)}  |  TAX (8%): $${totals.tax.toFixed(2)}  |  TOTAL: $${totals.total.toFixed(2)}`,
    { size: 10, font: boldFont },
  );

  builder.drawDivider();

  if (safeBookings.length === 0) {
    builder.drawText("No bookings found for the selected date range.", {
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4),
      decrementY: 20,
    });
  } else {
    // Booking rows
    for (const booking of safeBookings) {
      builder.ensureSpace(50);

      const confirmation = booking.confirmationId || (booking.id ? `WS-#${booking.id}` : "WS-#N/A");
      const venueName = booking.venue?.name || "Workspace";
      const dateStr = `${booking.date ?? ""} at ${booking.time ?? ""}`.trim();
      const rawDuration = booking.duration !== null && booking.duration !== undefined ? Number(booking.duration) : 60;
      const safeDuration = Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : 60;
      const durationStr = `${safeDuration} mins`;

      builder.drawText(`${confirmation} — ${safeText(venueName)}`, {
        size: 10,
        font: boldFont,
        decrementY: 12,
      });

      builder.drawText(`${dateStr} (${durationStr})`, {
        size: 8,
        font,
        color: rgb(0.4, 0.4, 0.4),
        decrementY: 16,
      });
    }
  }

  builder.addPageNumbers();
  return await builder.build();
}
