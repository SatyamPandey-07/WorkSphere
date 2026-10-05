/**
 * Venue Booking History Exporter (CSV).
 *
 * Implements RFC-4180 CSV export with formula injection sanitization
 * for venue bookings, reservation history, status tracking, and expense records.
 */

import { CsvBuilder, escapeCSVField } from "../csvBuilder";

export interface BookingHistoryExportItem {
  id: string;
  confirmationId?: string | null;
  date: string;
  time: string;
  duration?: number | null;
  seatNumber?: string | null;
  status?: "CONFIRMED" | "PENDING" | "CANCELLED" | string | null;
  createdAt?: string | Date | null;
  projectBillingCode?: string | null;
  venue?: {
    name?: string | null;
    category?: string | null;
    address?: string | null;
  } | null;
  [key: string]: unknown;
}

export interface BookingHistoryCsvOptions {
  filename?: string;
  venueName?: string;
  includeEstimates?: boolean;
}

export function formatBookingStatus(status?: string | null): string {
  if (!status) return "Confirmed";
  const s = status.toUpperCase();
  if (s === "CONFIRMED") return "Confirmed";
  if (s === "PENDING") return "Pending";
  if (s === "CANCELLED") return "Cancelled";
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export function generateBookingsCSV(
  bookings: BookingHistoryExportItem[],
  options: BookingHistoryCsvOptions = {},
): string {
  const builder = new CsvBuilder<BookingHistoryExportItem>({ lineDelimiter: "\n" });

  builder.setColumns([
    {
      header: "Confirmation ID",
      accessor: (b) => b.confirmationId || `WS-#${b.id}`,
    },
    {
      header: "Venue Name",
      accessor: (b) => b.venue?.name || options.venueName || "Workspace",
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
      accessor: (b) => String(b.duration || 60),
    },
    {
      header: "Status",
      accessor: (b) => formatBookingStatus(b.status),
    },
    {
      header: "Estimated Price ($)",
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

  builder.addRows(bookings);
  return builder.build();
}

export const exportBookingsToCSV = generateBookingsCSV;

export function downloadBookingsCSV(
  bookings: BookingHistoryExportItem[],
  options: BookingHistoryCsvOptions = {},
): Blob {
  const csvContent = generateBookingsCSV(bookings, options);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  const safeVenue = options.venueName
    ? options.venueName.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : "venue-bookings";
  const today = new Date().toISOString().slice(0, 10);
  const filename = options.filename || `${safeVenue}-history-${today}.csv`;

  const builder = new CsvBuilder();
  return builder.download.call({ toBlob: () => blob }, filename);
}
