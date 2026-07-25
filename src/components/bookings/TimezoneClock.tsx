"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";

interface TimezoneClockProps {
  /** IANA timezone string e.g. "America/New_York", "Asia/Kolkata" */
  timezone: string;
  /** Optional label shown next to the clock (e.g. venue city name) */
  label?: string;
}

/**
 * TimezoneClock — displays a live, localized clock for a given IANA timezone.
 * Updates every second via setInterval. Cleans up on unmount.
 */
export function TimezoneClock({ timezone, label }: TimezoneClockProps) {
  const [time, setTime] = useState<string>("");
  const [tzAbbr, setTzAbbr] = useState<string>("");
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    const tick = () => {
      try {
        const now = new Date();

        // Format the time in the venue's local timezone
        const timeFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        });

        // Extract the timezone abbreviation (e.g. "EST", "IST")
        const abbrFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          timeZoneName: "short",
        });

        const formattedTime = timeFormatter.format(now);
        const parts = abbrFormatter.formatToParts(now);
        const abbr =
          parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;

        setTime(formattedTime);
        setTzAbbr(abbr);
        setIsValid(true);
      } catch {
        // Invalid timezone string — show a graceful fallback
        setIsValid(false);
        setTime("--:--:-- --");
        setTzAbbr(timezone);
      }
    };

    // Run immediately so there's no 1-second blank on mount
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone]);

  if (!isValid) return null;

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
