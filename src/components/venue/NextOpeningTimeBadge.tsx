"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";
import { getVenueHoursStatus, type VenueHoursStatus } from "@/lib/venueHours";

export interface NextOpeningTimeBadgeProps {
  hours?: string | null;
  timezone?: string | null;
  className?: string;
  nowInput?: Date;
  /** If true, only renders when the venue is closed with next opening information */
  closedOnly?: boolean;
  "data-testid"?: string;
}

export function NextOpeningTimeBadge({
  hours,
  timezone,
  className = "",
  nowInput,
  closedOnly = false,
  ...props
}: NextOpeningTimeBadgeProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!hours || typeof hours !== "string" || !hours.trim()) {
    return null;
  }

  const status: VenueHoursStatus = getVenueHoursStatus(
    hours,
    nowInput,
    timezone,
  );

  if (!status.isAvailable || !status.badgeText) {
    return null;
  }

  if (closedOnly && (status.isOpen || status.is24Hours)) {
    return null;
  }

  const isOpen = status.isOpen || status.is24Hours;

  // Before hydration, render a neutral placeholder or matching text
  if (!isClient && !nowInput) {
    return (
      <span
        data-testid={props["data-testid"] ? `${props["data-testid"]}-ssr` : "next-opening-time-badge-ssr"}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium tracking-tight bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/50",
          className,
        )}
      >
        <Clock className="w-3 h-3 text-zinc-400 dark:text-zinc-500 shrink-0" />
        <span className="truncate">{status.badgeText}</span>
      </span>
    );
  }

  return (
    <span
      data-testid={props["data-testid"] || "next-opening-time-badge"}
      aria-label={`Venue operating status: ${status.badgeText}`}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium tracking-tight",
        isOpen
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/50"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/50",
        className,
      )}
      title={status.badgeText}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          isOpen ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
        }`}
      />
      <span>{status.badgeText}</span>
    </span>
  );
}

export default NextOpeningTimeBadge;
