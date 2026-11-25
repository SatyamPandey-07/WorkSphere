"use client";

import React, { useMemo } from "react";
import {
  getVenueOpeningStatus,
  type VenueOpeningHours,
} from "@/lib/venues/hours";

export interface VenueCardProps {
  id: string;
  name: string;
  neighborhood?: string;
  openingHours: VenueOpeningHours;
  currentTime?: Date | string | number;
  showCountdown?: boolean;
  onSelect?: (id: string) => void;
  className?: string;
  wifiSpeed?: number | null;
}

export const VenueCard: React.FC<VenueCardProps> = ({
  id,
  name,
  neighborhood,
  openingHours,
  currentTime,
  showCountdown = false,
  onSelect,
  className = "",
  wifiSpeed,
}) => {
  const status = useMemo(
    () => getVenueOpeningStatus(openingHours, currentTime),
    [openingHours, currentTime],
  );

  const badgeStyle =
    status.state === "open"
      ? "border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/60 dark:text-emerald-300"
      : status.state === "closing_soon"
        ? "border-amber-300/80 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-300"
        : "border-slate-300/80 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";

  return (
    <article
      data-testid={`venue-card-${id}`}
      onClick={() => onSelect?.(id)}
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 ${
        onSelect ? "cursor-pointer" : ""
      } ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {name}
          </h3>
          {neighborhood && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {neighborhood}
            </p>
          )}
        </div>

        <span
          role="status"
          aria-label={status.ariaLabel}
          data-testid="venue-opening-badge"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeStyle}`}
        >
          {status.state === "open" && (
            <span
              aria-hidden="true"
              className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"
            />
          )}
          <span>{status.badgeText}</span>
        </span>
        {typeof wifiSpeed === "number" && wifiSpeed >= 100 && (
          <span
            data-testid="gigabit-verified-badge"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300"
          >
            <span>Gigabit Verified</span>
          </span>
        )}
      </div>
    </article>
  );
};

export default VenueCard;
