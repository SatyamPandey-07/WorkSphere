"use client";

import React, { useState } from "react";
import { Download, Check, FileSpreadsheet } from "lucide-react";
import {
  VenueRatingRecord,
  downloadRatingsCSV,
} from "@/lib/venueRatingsCsvExport";

export interface ExportRatingsCSVButtonProps {
  ratings: VenueRatingRecord[];
  venueName?: string;
  filename?: string;
  className?: string;
  label?: string;
  variant?: "primary" | "secondary" | "outline" | "compact";
  disabled?: boolean;
  onExport?: () => void;
}

export function ExportRatingsCSVButton({
  ratings,
  venueName,
  filename,
  className = "",
  label = "Export Ratings CSV",
  variant = "outline",
  disabled = false,
  onExport,
}: ExportRatingsCSVButtonProps) {
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = () => {
    if (disabled || ratings.length === 0) return;

    downloadRatingsCSV(ratings, { venueName, filename });
    setDownloaded(true);
    if (onExport) {
      onExport();
    }
    setTimeout(() => {
      setDownloaded(false);
    }, 2500);
  };

  const isDisabled = disabled || ratings.length === 0;

  const baseStyles =
    "inline-flex items-center justify-center font-bold tracking-wider uppercase transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary-accent)]";

  const variantStyles = {
    primary:
      "bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md px-4 py-2 text-xs gap-2",
    secondary:
      "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl px-4 py-2 text-xs gap-2",
    outline:
      "border border-white/10 hover:border-white/20 bg-black/20 hover:bg-black/40 text-zinc-200 hover:text-white rounded-xl px-3.5 py-2 text-xs gap-2 shadow-sm",
    compact:
      "border border-white/10 hover:border-white/20 bg-zinc-900/40 hover:bg-zinc-900 text-zinc-300 hover:text-white rounded-lg px-2.5 py-1 text-[10px] gap-1.5",
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={isDisabled}
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      aria-label="Export ratings as CSV"
      title={
        ratings.length === 0
          ? "No rating records available to export"
          : `${label} (${ratings.length} ${ratings.length === 1 ? "record" : "records"})`
      }
    >
      {downloaded ? (
        <>
          <Check className={variant === "compact" ? "w-3 h-3 text-green-400" : "w-4 h-4 text-green-400"} />
          <span className="text-green-400">Exported</span>
        </>
      ) : (
        <>
          {variant === "compact" ? (
            <Download className="w-3 h-3 text-zinc-400" />
          ) : (
            <FileSpreadsheet className="w-4 h-4 text-zinc-300" />
          )}
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
