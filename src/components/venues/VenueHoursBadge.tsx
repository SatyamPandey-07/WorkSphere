"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  getVenueOpeningStatus,
  type VenueOpeningHours,
  type VenueOpeningStatus,
} from "@/lib/venues/hours";

export interface VenueHoursBadgeProps {
  openingHours?: VenueOpeningHours;
  currentTime?: Date | string | number;
  showCountdown?: boolean;
  className?: string;
}

export const VenueHoursBadge: React.FC<VenueHoursBadgeProps> = ({
  openingHours = {},
  currentTime,
  showCountdown = true,
  className = "",
}) => {
  const [ticker, setTicker] = useState<Date>(() =>
    currentTime != null ? new Date(currentTime) : new Date(),
  );

  useEffect(() => {
    if (currentTime != null) {
      setTicker(new Date(currentTime));
      return;
    }

    const intervalId = setInterval(() => {
      setTicker(new Date());
    }, 60_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [currentTime]);

  const activeTime = currentTime != null ? currentTime : ticker;

  const status: VenueOpeningStatus = useMemo(
    () => getVenueOpeningStatus(openingHours, activeTime),
    [openingHours, activeTime],
  );

  const badgeStyle =
    status.state === "open"
      ? "border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/60 dark:text-emerald-300"
      : status.state === "closing_soon"
        ? "border-amber-300/80 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-300"
        : "border-slate-300/80 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";

  const displayText =
    showCountdown && status.countdownText
      ? status.countdownText
      : status.badgeText;

  return (
    <span
      role="status"
      aria-label={status.ariaLabel}
      data-testid="venue-opening-badge"
      data-state={status.state}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeStyle} ${className}`.trim()}
    >
      {status.state === "open" && (
        <span
          aria-hidden="true"
          className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"
        />
      )}
      {status.state === "closing_soon" && (
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-amber-500"
        />
      )}
      <span>{displayText}</span>
    </span>
  );
};

export default VenueHoursBadge;
