"use client";

import React, { useState, useEffect, useRef } from "react";
import { Download, Check, FileSpreadsheet } from "lucide-react";
import {
  BookingHistoryExportItem,
  downloadBookingsCSV,
  downloadBookingsExcel,
} from "@/lib/venueBookingCsvExport";

export interface ExportBookingsCSVButtonProps {
  bookings: BookingHistoryExportItem[];
  venueName?: string;
  filename?: string;
  className?: string;
  label?: string;
  variant?: "primary" | "secondary" | "outline" | "compact";
  format?: "csv" | "xlsx";
  disabled?: boolean;
  testId?: string;
  onExport?: () => void;
  onError?: (error: Error) => void;
}

export function ExportBookingsCSVButton({
  bookings,
  venueName,
  filename,
  className = "",
  label,
  variant = "outline",
  format = "csv",
  disabled = false,
  testId = "export-bookings-btn",
  onExport,
  onError,
}: ExportBookingsCSVButtonProps) {
  const [downloaded, setDownloaded] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const safeBookings = Array.isArray(bookings) ? bookings : [];
  const displayLabel = label || (format === "xlsx" ? "Export Excel" : "Export CSV");
  const count = safeBookings.length;
  const isDisabled = disabled || count === 0;

  const handleDownload = () => {
    if (isDisabled) return;

    try {
      if (format === "xlsx") {
        downloadBookingsExcel(safeBookings, { venueName, filename });
      } else {
        downloadBookingsCSV(safeBookings, { venueName, filename });
      }

      setDownloaded(true);
      onExport?.();

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setDownloaded(false);
      }, 2500);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      onError?.(errorObj);
    }
  };

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

  const titleText =
    count === 0
      ? "No bookings available to export"
      : `${displayLabel} (${count} ${count === 1 ? "booking" : "bookings"})`;

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={handleDownload}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className={`${baseStyles} ${variantStyles[variant]} ${className}`.trim()}
      aria-label={`Export booking history as ${format === "xlsx" ? "Excel" : "CSV"}`}
      title={titleText}
    >
      <span className="sr-only" aria-live="polite">
        {downloaded ? "Booking history exported successfully" : ""}
      </span>
      {downloaded ? (
        <>
          <Check
            data-testid={`${testId}-success-icon`}
            className={variant === "compact" ? "w-3 h-3 text-green-500" : "w-3.5 h-3.5 text-green-500"}
          />
          <span data-testid={`${testId}-success-label`} className="text-green-500">
            Exported
          </span>
        </>
      ) : (
        <>
          {variant === "compact" ? (
            <Download
              data-testid={`${testId}-download-icon`}
              className="w-3 h-3 text-zinc-400"
            />
          ) : (
            <FileSpreadsheet
              data-testid={`${testId}-spreadsheet-icon`}
              className="w-3.5 h-3.5 text-zinc-400"
            />
          )}
          <span data-testid={`${testId}-label`}>{displayLabel}</span>
        </>
      )}
    </button>
  );
}

export function ExportBookingsExcelButton(
  props: Omit<ExportBookingsCSVButtonProps, "format">,
) {
  return (
    <ExportBookingsCSVButton
      {...props}
      format="xlsx"
      label={props.label || "Export Excel (.xlsx)"}
    />
  );
}

export default ExportBookingsCSVButton;
