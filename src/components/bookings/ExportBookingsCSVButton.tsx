"use client";

import React, { useState } from "react";
import { Download, Check, FileSpreadsheet } from "lucide-react";
import {
  BookingHistoryExportItem,
  downloadBookingsCSV,
  BookingHistoryCsvOptions,
} from "@/lib/venueBookingCsvExport";

export interface ExportBookingsCSVButtonProps {
  bookings: BookingHistoryExportItem[];
  venueName?: string;
  filename?: string;
  className?: string;
  label?: string;
  variant?: "primary" | "secondary" | "outline" | "compact";
  disabled?: boolean;
  onExport?: () => void;
}

export function ExportBookingsCSVButton({
  bookings,
  venueName,
  filename,
  className = "",
  label = "Export CSV",
  variant = "outline",
  disabled = false,
  onExport,
}: ExportBookingsCSVButtonProps) {
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = () => {
    if (disabled || bookings.length === 0) return;

    downloadBookingsCSV(bookings, { venueName, filename });
    setDownloaded(true);
    if (onExport) {
      onExport();
    }
    setTimeout(() => {
      setDownloaded(false);
    }, 2500);
  };

  const isDisabled = disabled || bookings.length === 0;

  const baseStyles =
    "inline-flex items-center justify-center font-semibold transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary-accent)]";

  const variantStyles = {
    primary:
      "bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md px-3.5 py-1.5 text-xs gap-1.5",
    secondary:
      "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl px-3.5 py-1.5 text-xs gap-1.5",
    outline:
      "border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white rounded-xl px-3 py-1.5 text-xs gap-1.5 shadow-sm",
    compact:
      "border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg px-2.5 py-1 text-[11px] gap-1.5",
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={isDisabled}
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      aria-label="Export booking history as CSV"
      title={
        bookings.length === 0
          ? "No bookings available to export"
          : `${label} (${bookings.length} ${bookings.length === 1 ? "booking" : "bookings"})`
      }
    >
      {downloaded ? (
        <>
          <Check className={variant === "compact" ? "w-3 h-3 text-green-500" : "w-3.5 h-3.5 text-green-500"} />
          <span className="text-green-500">Exported</span>
        </>
      ) : (
        <>
          {variant === "compact" ? (
            <Download className="w-3 h-3 text-zinc-400" />
          ) : (
            <FileSpreadsheet className="w-3.5 h-3.5 text-zinc-400" />
          )}
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
