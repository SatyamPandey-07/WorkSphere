"use client";

import React, { useEffect, useState } from "react";
import { Globe } from "lucide-react";

interface TimezoneClockProps {
  /** IANA timezone string e.g. "America/New_York", "Asia/Kolkata" */
  timeZone: string;
  /** Optional label shown next to the clock (e.g. venue city name) */
  label?: string;
}

/**
 * TimezoneClock — displays a live, localized clock for a given IANA timezone.
 * Updates every second via setInterval. Cleans up on unmount.
 */
export function TimezoneClock({ timeZone, label }: TimezoneClockProps) {
  const [time, setTime] = useState<string>(() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(new Date());
    } catch {
      return "--:--:-- --";
    }
  });
  const [tzAbbr, setTzAbbr] = useState<string>(() => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "short",
      }).formatToParts(new Date());
      return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
    } catch {
      return timeZone;
    }
  });
  const [isValid, setIsValid] = useState(() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      return true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const tick = () => {
      try {
        const now = new Date();

        // Format the time in the venue's local timezone
        const timeFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        });

        // Extract the timezone abbreviation (e.g. "EST", "IST")
        const abbrFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone,
          timeZoneName: "short",
        });

        const formattedTime = timeFormatter.format(now);
        const parts = abbrFormatter.formatToParts(now);
        const abbr =
          parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;

        setTime(formattedTime);
        setTzAbbr(abbr);
        setIsValid(true);
      } catch {
        // Invalid timezone string — show a graceful fallback
        setIsValid(false);
        setTime("--:--:-- --");
        setTzAbbr(timeZone);
      }
    };

    // Run immediately so there's no 1-second blank on mount
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeZone]);

  if (!isValid) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums mt-1">
        <Globe className="w-3 h-3 shrink-0 text-red-400" />
        <span className="text-zinc-900 dark:text-zinc-100 font-semibold">
          --:--:-- --
        </span>
        <span className="text-zinc-400 dark:text-zinc-500">
          {tzAbbr || timeZone}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums mt-1">
      <Globe className="w-3 h-3 shrink-0 text-blue-400" />
      <span className="text-zinc-900 dark:text-zinc-100 font-semibold">
        {time}
      </span>
      <span className="text-zinc-400 dark:text-zinc-500">{tzAbbr}</span>
      {label && (
        <span className="text-zinc-400 dark:text-zinc-500 ml-0.5">
          · {label}
        </span>
      )}
    </div>
  );
}
