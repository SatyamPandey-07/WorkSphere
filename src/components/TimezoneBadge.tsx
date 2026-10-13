"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { CopyToClipboardButton } from "@/components/ui/CopyToClipboardButton";

/**
 * Returns the browser's IANA timezone (e.g. "Asia/Kolkata"),
 * falling back to "UTC" if the Intl API is unavailable or returns nothing.
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Formats current local time using Intl.DateTimeFormat.
 */
export function formatLocalTime(
  date: Date,
  timeZone: string,
  locale?: string,
): string | null {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    });
    if (typeof formatter?.format !== "function") return null;
    return formatter.format(date);
  } catch {
    return null;
  }
}

/**
 * Calculates day difference between target timezone and client timezone.
 * Returns positive if target timezone is ahead (e.g. +1), negative if behind (e.g. -1), or 0 if same day.
 */
export function getDayDifference(
  date: Date,
  targetTimezone: string,
  clientTimezone?: string,
): number {
  try {
    const clientTz = clientTimezone || getUserTimezone();
    const formatterClient = new Intl.DateTimeFormat("en-CA", {
      timeZone: clientTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const formatterTarget = new Intl.DateTimeFormat("en-CA", {
      timeZone: targetTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    if (
      typeof formatterClient?.format !== "function" ||
      typeof formatterTarget?.format !== "function"
    ) {
      return 0;
    }

    const clientDateStr = formatterClient.format(date);
    const targetDateStr = formatterTarget.format(date);

    if (clientDateStr === targetDateStr) return 0;

    const [cY, cM, cD] = clientDateStr.split("-").map(Number);
    const [tY, tM, tD] = targetDateStr.split("-").map(Number);

    const clientUtc = Date.UTC(cY, cM - 1, cD);
    const targetUtc = Date.UTC(tY, tM - 1, tD);

    return Math.round((targetUtc - clientUtc) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * Formats day indicator label (e.g. "+1 day", "-1 day").
 */
export function formatDayIndicator(dayDiff: number): string | null {
  if (dayDiff === 0) return null;
  if (dayDiff > 0) return `+${dayDiff} day${dayDiff > 1 ? "s" : ""}`;
  return `${dayDiff} day${dayDiff < -1 ? "s" : ""}`;
}

export interface TimezoneBadgeProps {
  timeZone?: string;
  timezone?: string;
  locale?: string;
  clientTimezone?: string;
}

export function TimezoneBadge({
  timeZone: propTimeZone,
  timezone: propTimezoneAlias,
  locale,
  clientTimezone,
}: TimezoneBadgeProps = {}) {
  const propTimezone = propTimeZone || propTimezoneAlias;
  // Detect on the client only, to avoid server/client hydration mismatches.
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (!propTimezone) {
      setDetectedTimezone(getUserTimezone());
    }
  }, [propTimezone]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const activeTimezone = propTimezone || detectedTimezone;
  const formattedTime =
    isMounted && activeTimezone
      ? formatLocalTime(now, activeTimezone, locale)
      : null;
  const dayDiff =
    isMounted && activeTimezone
      ? getDayDifference(now, activeTimezone, clientTimezone)
      : 0;
  const dayIndicator = formatDayIndicator(dayDiff);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
          <Globe className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Your timezone
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium" data-testid="timezone-value">
              {activeTimezone ?? "Detecting…"}
            </p>
            {formattedTime && (
              <div
                className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 font-normal"
                data-testid="timezone-time"
              >
                <span aria-hidden="true">•</span>
                <span data-testid="local-time-clock">{formattedTime}</span>
                {dayIndicator && (
                  <span
                    className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400"
                    data-testid="day-indicator"
                  >
                    {dayIndicator}
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Detected from your browser. Useful for knowing when reminders and
            quiet hours trigger.
          </p>
        </div>
      </div>
      {activeTimezone && (
        <CopyToClipboardButton
          textToCopy={activeTimezone}
          label="Copy"
          toastMessage="Timezone copied!"
        />
      )}
    </div>
  );
}
