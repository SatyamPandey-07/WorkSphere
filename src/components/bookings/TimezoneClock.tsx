import React, { useEffect, useMemo, useRef, useState } from "react";
import { Globe, Search, X, ChevronDown } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";

export interface TimezoneClockProps {
  /** IANA timezone string e.g. "America/New_York", "Asia/Kolkata" */
  timeZone: string;
  /** Optional label shown next to the clock (e.g. venue city name) */
  label?: string;
  /** Optional reference date or booking date to evaluate Daylight Saving Time (DST) */
  date?: Date | string | number;
  /** Whether to enable interactive timezone selection */
  selectable?: boolean;
  /** Callback invoked when the user selects a different timezone */
  onTimezoneChange?: (newTimeZone: string) => void;
}

const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function getAllTimezones(): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return FALLBACK_TIMEZONES;
    }
  }
  return FALLBACK_TIMEZONES;
}

/**
 * TimezoneClock — displays a live, localized clock for a given IANA timezone.
 * Handles Daylight Saving Time (DST) transitions accurately via Intl.DateTimeFormat.
 * Updates every second via setInterval. Cleans up on unmount.
 */
export function TimezoneClock({
  timeZone,
  label,
  date,
  selectable = false,
  onTimezoneChange,
}: TimezoneClockProps) {
  const cleanTz = timeZone?.trim() || "";

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 200);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allTimezones = useMemo(() => getAllTimezones(), []);

  // Filter timezones based on debounced search query (city, country, region, abbreviation)
  const filteredTimezones = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return allTimezones;

    return allTimezones.filter((tz) => {
      const lower = tz.toLowerCase();
      // Match raw tz name (e.g. "america/new_york", "asia/tokyo")
      if (lower.includes(q)) return true;

      // Match city / parts with spaces / underscores replaced
      const formatted = lower.replace(/_/g, " ");
      if (formatted.includes(q)) return true;

      // Common abbreviation matching
      if (q === "est" || q === "edt") return lower.includes("new_york");
      if (q === "cst" || q === "cdt") return lower.includes("chicago");
      if (q === "mst" || q === "mdt") return lower.includes("denver");
      if (q === "pst" || q === "pdt") return lower.includes("los_angeles");
      if (q === "ist") return lower.includes("kolkata");
      if (q === "jst") return lower.includes("tokyo");
      if (q === "gmt" || q === "bst") return lower.includes("london") || lower === "utc";

      return false;
    });
  }, [allTimezones, debouncedQuery]);

  const getReferenceDate = () => {
    if (date) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  };

  const [time, setTime] = useState<string>(() => {
    if (!cleanTz) return "--:--:-- --";
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: cleanTz,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(getReferenceDate());
    } catch {
      return "--:--:-- --";
    }
  });

  const [tzAbbr, setTzAbbr] = useState<string>(() => {
    if (!cleanTz) return timeZone;
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: cleanTz,
        timeZoneName: "short",
      }).formatToParts(getReferenceDate());
      return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
    } catch {
      return timeZone;
    }
  });

  const [isValid, setIsValid] = useState(() => {
    if (!cleanTz) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: cleanTz });
      return true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const tzToFormat = timeZone?.trim() || "";
    if (!tzToFormat) {
      setIsValid(false);
      setTime("--:--:-- --");
      setTzAbbr(timeZone);
      return;
    }

    const tick = () => {
      try {
        const now = getReferenceDate();

        // Format the time in the venue's local timezone
        const timeFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: tzToFormat,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        });

        // Extract the timezone abbreviation (e.g. "EST", "EDT", "IST")
        const abbrFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: tzToFormat,
          timeZoneName: "short",
        });

        const formattedTime = timeFormatter.format(now);
        const parts = abbrFormatter.formatToParts(now);
        const abbr =
          parts.find((p) => p.type === "timeZoneName")?.value ?? tzToFormat;

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
  }, [timeZone, date]);

  // Click outside to close dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const clockContent = (
    <div
      suppressHydrationWarning
      className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums"
    >
      <Globe className={`w-3 h-3 shrink-0 ${isValid ? "text-blue-400" : "text-red-400"}`} />
      <span
        suppressHydrationWarning
        className="text-zinc-900 dark:text-zinc-100 font-semibold"
      >
        {time}
      </span>
      <span
        suppressHydrationWarning
        className="text-zinc-400 dark:text-zinc-500"
      >
        {isValid ? tzAbbr : tzAbbr || timeZone}
      </span>
      {label && (
        <span className="text-zinc-400 dark:text-zinc-500 ml-0.5">
          · {label}
        </span>
      )}
    </div>
  );

  if (!selectable) {
    return (
      <div className="mt-1 inline-flex items-center">
        {clockContent}
      </div>
    );
  }

  return (
    <div className="relative mt-1 inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        data-testid="timezone-selector-button"
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-left text-xs transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
      >
        {clockContent}
        <ChevronDown className="h-3 w-3 text-zinc-400 ml-1 shrink-0" />
      </button>

      {isOpen && (
        <div
          data-testid="timezone-dropdown-panel"
          className="absolute left-0 z-50 mt-1.5 w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900"
        >
          {/* Instant Search input */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search city, country, or timezone..."
              autoFocus
              data-testid="timezone-search-input"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-7 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:bg-white dark:border-zinc-750 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear query"
                data-testid="timezone-clear-query-button"
                className="absolute right-2 top-2 rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Timezone list or empty state */}
          <div
            role="listbox"
            data-testid="timezone-results-list"
            className="max-h-56 overflow-y-auto space-y-0.5 rounded-lg text-xs"
          >
            {filteredTimezones.length === 0 ? (
              <div
                data-testid="timezone-no-results"
                className="py-6 px-3 text-center text-zinc-500 dark:text-zinc-400"
              >
                <p className="font-medium">No matching timezones found</p>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  data-testid="timezone-clear-search-btn"
                  className="mt-2 text-xs text-blue-500 hover:underline inline-flex items-center gap-1"
                >
                  Clear search query
                </button>
              </div>
            ) : (
              filteredTimezones.map((tz) => {
                const isSelected = tz === cleanTz;
                return (
                  <button
                    key={tz}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onTimezoneChange?.(tz);
                      setIsOpen(false);
                      setSearchQuery("");
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                      isSelected
                        ? "bg-blue-500/10 font-semibold text-blue-500 dark:text-blue-400"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="truncate">{tz.replace(/_/g, " ")}</span>
                    {isSelected && (
                      <span className="ml-2 text-[10px] uppercase font-bold text-blue-500">
                        Selected
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
