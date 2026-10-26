/**
 * Venue Booking History Exporter (CSV).
 *
 * Implements RFC-4180 CSV export with formula injection sanitization
 * for venue bookings, reservation history, status tracking, and expense records.
 */

import { CsvBuilder, triggerBrowserDownload } from "../csvBuilder";
import { ExcelXmlBuilder } from "../excelBuilder";

export interface BookingHistoryExportItem {
  id: string;
  confirmationId?: string | null;
  date: string;
  time: string;
  duration?: number | string | null;
  seatNumber?: string | null;
  status?: "CONFIRMED" | "PENDING" | "CANCELLED" | string | null;
  createdAt?: string | Date | null;
  projectBillingCode?: string | null;
  venue?: {
    name?: string | null;
    category?: string | null;
    address?: string | null;
  } | null;
}

export interface BookingHistoryCsvOptions {
  filename?: string;
  venueName?: string;
  includeEstimates?: boolean;
}

export function formatBookingStatus(status?: string | null): string {
  if (!status || typeof status !== "string") return "Confirmed";
  const s = status.toUpperCase();
  if (s === "CONFIRMED") return "Confirmed";
  if (s === "PENDING") return "Pending";
  if (s === "CANCELLED") return "Cancelled";
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function getSafeDurationHours(duration?: number | string | null): number {
  if (duration === null || duration === undefined) return 1;
  const num = typeof duration === "number" ? duration : Number(duration);
  const raw = Number.isFinite(num) ? num : 60;
  const minutes = raw < 0 ? 0 : raw;
  return minutes / 60;
}

export function generateBookingsCSV(
  bookings: BookingHistoryExportItem[],
  options: BookingHistoryCsvOptions = {},
): string {
  const safeOptions = options || {};
  const safeBookings = Array.isArray(bookings)
    ? bookings.filter((b): b is BookingHistoryExportItem => Boolean(b && typeof b === "object"))
    : [];
  const builder = new CsvBuilder<BookingHistoryExportItem>({ lineDelimiter: "\r\n" });

  builder.setColumns([
    {
      header: "Confirmation ID",
      accessor: (b) => b.confirmationId || (b.id ? `WS-#${b.id}` : "WS-#N/A"),
    },
    {
      header: "Venue Name",
      accessor: (b) => b.venue?.name || safeOptions.venueName || "Workspace",
    },
    {
      header: "Category",
      accessor: (b) => b.venue?.category || "Coworking",
    },
    {
      header: "Address",
      accessor: (b) => b.venue?.address || "",
    },
    {
      header: "Date",
      accessor: (b) => b.date,
    },
    {
      header: "Time",
      accessor: (b) => b.time,
    },
    {
      header: "Seat Number",
      accessor: (b) => b.seatNumber || "General",
    },
    {
      header: "Duration (mins)",
      accessor: (b) => {
        const raw = b.duration !== null && b.duration !== undefined ? Number(b.duration) : 60;
        return String(!Number.isFinite(raw) || raw < 0 ? 0 : raw);
      },
    },
    {
      header: "Status",
      accessor: (b) => formatBookingStatus(b.status),
    },
    {
      header: "Estimated Price ($)",
      accessor: (b) => {
        const hours = getSafeDurationHours(b.duration);
        return (hours * 15).toFixed(2);
      },
    },
    {
      header: "Tax ($)",
      accessor: (b) => {
        const hours = getSafeDurationHours(b.duration);
        const price = hours * 15;
        return (price * 0.08).toFixed(2);
      },
    },
    {
      header: "Total ($)",
      accessor: (b) => {
        const hours = getSafeDurationHours(b.duration);
        const price = hours * 15;
        const tax = Number((price * 0.08).toFixed(2));
        return (price + tax).toFixed(2);
      },
    },
    {
      header: "Billing Code",
      accessor: (b) => b.projectBillingCode || "N/A",
    },
    {
      header: "Booked At",
      accessor: (b) => {
        if (!b.createdAt) return "";
        try {
          return new Date(b.createdAt).toISOString();
        } catch {
          return String(b.createdAt);
        }
      },
    },
  ]);

  builder.addRows(safeBookings);
  return builder.build();
}

export const exportBookingsToCSV = generateBookingsCSV;

export function downloadBookingsCSV(
  bookings: BookingHistoryExportItem[],
  options: BookingHistoryCsvOptions = {},
): Blob {
  const safeOptions = options || {};
  const csvContent = generateBookingsCSV(bookings, safeOptions);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  const safeVenue = safeOptions.venueName
    ? safeOptions.venueName.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : "venue-bookings";
  const today = new Date().toISOString().slice(0, 10);
  const filename = safeOptions.filename || `${safeVenue}-history-${today}.csv`;

  triggerBrowserDownload(blob, filename);
  return blob;
}

export interface BookingHistoryExcelOptions {
  filename?: string;
  venueName?: string;
  sheetName?: string;
}

export function generateBookingsExcel(
  bookings: BookingHistoryExportItem[],
  options: BookingHistoryExcelOptions = {},
): string {
  const safeOptions = options || {};
  const safeBookings = Array.isArray(bookings)
    ? bookings.filter((b): b is BookingHistoryExportItem => Boolean(b && typeof b === "object"))
    : [];
  const builder = new ExcelXmlBuilder<BookingHistoryExportItem>({
    worksheetName: safeOptions.sheetName || "Bookings",
    author: "WorkSphere",
  });

  builder.setColumns([
    {
      header: "Confirmation ID",
      type: "String",
      accessor: (b) => b.confirmationId || (b.id ? `WS-#${b.id}` : "WS-#N/A"),
    },
    {
      header: "Venue Name",
      type: "String",
      accessor: (b) => b.venue?.name || safeOptions.venueName || "Workspace",
    },
    {
      header: "Category",
      type: "String",
      accessor: (b) => b.venue?.category || "Coworking",
    },
    {
      header: "Address",
      type: "String",
      accessor: (b) => b.venue?.address || "",
    },
    {
      header: "Date",
      type: "Date",
      accessor: (b) => b.date,
    },
    {
      header: "Time",
      type: "String",
      accessor: (b) => b.time,
    },
    {
      header: "Seat Number",
      type: "String",
      accessor: (b) => b.seatNumber || "General",
    },
    {
      header: "Duration (mins)",
      type: "Number",
      accessor: (b) => {
        const raw = b.duration !== null && b.duration !== undefined ? Number(b.duration) : 60;
        return !Number.isFinite(raw) || raw < 0 ? 0 : raw;
      },
    },
    {
      header: "Status",
      type: "String",
      accessor: (b) => formatBookingStatus(b.status),
    },
    {
      header: "Estimated Price ($)",
      type: "Currency",
      accessor: (b) => {
        const hours = getSafeDurationHours(b.duration);
        return Number((hours * 15).toFixed(2));
      },
    },
    {
      header: "Tax ($)",
      type: "Currency",
      accessor: (b) => {
        const hours = getSafeDurationHours(b.duration);
        const price = hours * 15;
        return Number((price * 0.08).toFixed(2));
      },
    },
    {
      header: "Total ($)",
      type: "Currency",
      accessor: (b) => {
        const hours = getSafeDurationHours(b.duration);
        const price = hours * 15;
        const tax = Number((price * 0.08).toFixed(2));
        return Number((price + tax).toFixed(2));
      },
    },
    {
      header: "Billing Code",
      type: "String",
      accessor: (b) => b.projectBillingCode || "N/A",
    },
    {
      header: "Booked At",
      type: "DateTime",
      accessor: (b) => {
        if (!b.createdAt) return "";
        try {
          return new Date(b.createdAt).toISOString();
        } catch {
          return String(b.createdAt);
        }
      },
    },
  ]);

  builder.addRows(safeBookings);
  return builder.build();
}

export const exportBookingsToExcel = generateBookingsExcel;

export function downloadBookingsExcel(
  bookings: BookingHistoryExportItem[],
  options: BookingHistoryExcelOptions = {},
): Blob {
  const safeOptions = options || {};
  const safeVenue = safeOptions.venueName
    ? safeOptions.venueName.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : "venue-bookings";
  const today = new Date().toISOString().slice(0, 10);
  const filename = safeOptions.filename || `${safeVenue}-history-${today}.xlsx`;
  const safeFilename =
    filename.endsWith(".xlsx") || filename.endsWith(".xml")
      ? filename
      : `${filename}.xlsx`;

  const xmlContent = generateBookingsExcel(bookings, safeOptions);
  const blob = new Blob([xmlContent], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8",
  });

  triggerBrowserDownload(blob, safeFilename);
  return blob;
}
