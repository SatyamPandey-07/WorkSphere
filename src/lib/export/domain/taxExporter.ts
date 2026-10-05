/**
 * Tax & Expense Exporter (CSV and PDF).
 *
 * Consolidates tax summary calculations, date range resolution, CSV export,
 * and multi-page expense summary PDF generation.
 */

import { CsvBuilder } from "../csvBuilder";
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

export function filterBookingsByRange<T extends { date: string }>(
  bookings: T[],
  range: DateRange,
): T[] {
  return bookings.filter((b) => b.date >= range.start && b.date <= range.end);
}

export function computeTaxTotals(
  bookings: { duration?: number | null }[],
): TaxTotals {
  let subtotal = 0;
  let tax = 0;

  for (const b of bookings) {
    const hours = Math.max(0, b.duration ?? 60) / 60;
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

export function bookingsToCSV(bookings: ExportableBooking[]): string {
  const builder = new CsvBuilder<ExportableBooking>({ lineDelimiter: "\n" });
  builder.setColumns([
    {
      header: "Confirmation ID",
      accessor: (b) => b.confirmationId || `WS-#${b.id}`,
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
        const hours = (b.duration || 60) / 60;
        return (hours * 15).toFixed(2);
      },
    },
    {
      header: "Tax ($)",
      accessor: (b) => {
        const hours = (b.duration || 60) / 60;
        const price = hours * 15;
        return (price * 0.08).toFixed(2);
      },
    },
    {
      header: "Total ($)",
      accessor: (b) => {
        const hours = (b.duration || 60) / 60;
        const price = hours * 15;
        const tax = Number((price * 0.08).toFixed(2));
        return (price + tax).toFixed(2);
      },
    },
  ]);

  builder.addRows(bookings);
  return builder.build();
}

export function taxBookingsToCSV(bookings: ExportableBooking[]): string {
  return bookingsToCSV(bookings);
}

export async function generateTaxExportPdf(
  bookings: any[],
): Promise<Uint8Array> {
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

  const totals = computeTaxTotals(bookings);

  builder.drawText(`TOTAL BOOKINGS: ${totals.count}`, {
    size: 11,
    font: boldFont,
  });

  builder.drawText(
    `SUBTOTAL: $${totals.subtotal.toFixed(2)}  |  TAX (8%): $${totals.tax.toFixed(2)}  |  TOTAL: $${totals.total.toFixed(2)}`,
    { size: 10, font: boldFont },
  );

  builder.drawDivider();

  // Booking rows
  for (const booking of bookings) {
    builder.ensureSpace(50);

    const confirmation = booking.confirmationId || `WS-#${booking.id}`;
    const venueName = booking.venue?.name || "Workspace";
    const dateStr = `${booking.date} at ${booking.time}`;
    const duration = booking.duration ? `${booking.duration} mins` : "60 mins";

    builder.drawText(`${confirmation} — ${safeText(venueName)}`, {
      size: 10,
      font: boldFont,
      decrementY: 12,
    });

    builder.drawText(`${dateStr} (${duration})`, {
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
      decrementY: 16,
    });
  }

  builder.addPageNumbers();
  return await builder.build();
}
