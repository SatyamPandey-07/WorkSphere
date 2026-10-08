export interface DayPeriod {
  open: string;  // "08:00"
  close: string; // "20:00"
  closed?: boolean;
}

export interface StructuredHours {
  timezone?: string;
  periods?: Record<string, DayPeriod>;
}

export interface VenueHoursStatus {
  isOpen: boolean;
  badgeText: string;
  status: "open" | "closed" | "24/7" | "unknown";
  closesAt?: string | null;
  opensAt?: string | null;
  opensNext?: string | null;
  is24Hours?: boolean;
  isAvailable: boolean;
}

export const DAYS_OF_WEEK = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Formats a 24h time string like "08:00" or "20:00" to "8 AM" or "8 PM"
 * (or "8:30 PM" if minutes are non-zero).
 */
export function formatTimeBadge(time24: string): string {
  if (!time24 || typeof time24 !== "string") return "";
  const trimmed = time24.trim();
  
  // Already in 12h format?
  if (/am|pm/i.test(trimmed)) {
    return trimmed;
  }

  const parts = trimmed.split(":");
  if (parts.length < 2) return trimmed;
  
  let h = Number(parts[0]);
  const m = Number(parts[1]);
  if (isNaN(h) || isNaN(m)) return trimmed;

  if (h === 24) h = 0;
  
  const ampm = h >= 12 && h < 24 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  
  if (m === 0) {
    return `${displayH} ${ampm}`;
  }
  const displayM = String(m).padStart(2, "0");
  return `${displayH}:${displayM} ${ampm}`;
}

/**
 * Checks if a string represents a 24/7 operating venue.
 */
export function is24HoursString(hoursStr: string): boolean {
  if (!hoursStr) return false;
  const normalized = hoursStr.trim().toLowerCase();
  return (
    normalized === "24/7" ||
    normalized === "open 24 hours" ||
    normalized === "open 24/7" ||
    normalized === "24 hours" ||
    normalized === "24 hour" ||
    normalized === "all day" ||
    normalized === "00:00 - 24:00" ||
    normalized === "00:00-24:00" ||
    normalized === "00:00 - 00:00" ||
    normalized === "00:00-00:00" ||
    normalized.includes("open 24") ||
    normalized.includes("24/7")
  );
}

/**
 * Converts a "HH:MM" string to minutes from midnight (0..1439).
 */
function timeToMinutes(timeStr: string): number {
  const parts = timeStr.trim().split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

/**
 * Helper to parse structured JSON opening hours if present.
 */
function parseStructuredJson(hoursStr: string): StructuredHours | null {
  try {
    const parsed = JSON.parse(hoursStr);
    if (parsed && typeof parsed === "object") {
      if (parsed.periods || parsed.monday || parsed.tuesday) {
        return parsed.periods ? parsed : { periods: parsed };
      }
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Resolves and validates an IANA timezone identifier.
 * Falls back safely to 'UTC' when timezone is null, undefined, empty, or invalid,
 * preventing unhandled RangeError: Invalid time zone specified.
 */
export function resolveTimezone(
  timezone?: string | null,
  fallback = "UTC",
): string {
  if (!timezone || typeof timezone !== "string" || !timezone.trim()) {
    return fallback;
  }
  const trimmed = timezone.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return fallback;
  }
}

/**
 * Evaluates the current venue operating status against the local time and day.
 */
export function getVenueHoursStatus(
  hoursStr: string | null | undefined,
  nowInput?: Date,
  timezone?: string | null,
): VenueHoursStatus {
  if (!hoursStr || typeof hoursStr !== "string" || !hoursStr.trim()) {
    return {
      isOpen: false,
      badgeText: "",
      status: "unknown",
      isAvailable: false,
    };
  }

  const trimmed = hoursStr.trim();

  // 1. Check 24/7 venues
  if (is24HoursString(trimmed)) {
    return {
      isOpen: true,
      badgeText: "Open 24 Hours",
      status: "24/7",
      is24Hours: true,
      isAvailable: true,
    };
  }

  const now = nowInput || new Date();

  // Parse structured JSON early to extract possible structured.timezone
  const structured = parseStructuredJson(trimmed);

  // Get current local day and minutes
  let currentDayIdx = now.getDay(); // 0 = Sunday, 1 = Monday, ...
  let currentMinutes = now.getHours() * 60 + now.getMinutes();

  const rawTimezone =
    timezone !== undefined && timezone !== null
      ? timezone
      : structured?.timezone;

  if (
    rawTimezone !== undefined &&
    rawTimezone !== null &&
    typeof rawTimezone === "string" &&
    rawTimezone.trim() !== ""
  ) {
    const safeTz = resolveTimezone(rawTimezone, "UTC");
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: safeTz,
        weekday: "long",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
      const dayName = (partMap.weekday || "").toLowerCase();
      const mappedIdx = DAYS_OF_WEEK.indexOf(dayName);
      if (mappedIdx !== -1) currentDayIdx = mappedIdx;
      const h = Number(partMap.hour === "24" ? 0 : partMap.hour || 0);
      const m = Number(partMap.minute || 0);
      currentMinutes = h * 60 + m;
    } catch {
      // Fallback to local time
    }
  }

  // 2. Check Structured JSON Hours
  const structured = parseStructuredJson(trimmed);
  if (structured?.periods) {
    const periods = structured.periods;
    const todayName = DAYS_OF_WEEK[currentDayIdx];
    const prevName = DAYS_OF_WEEK[(currentDayIdx + 6) % 7];
    const tomorrowName = DAYS_OF_WEEK[(currentDayIdx + 1) % 7];

    const todayPeriod = periods[todayName];
    const prevPeriod = periods[prevName];

    // Check if open from previous day's overnight shift
    if (prevPeriod && !prevPeriod.closed && prevPeriod.open && prevPeriod.close) {
      const pOpen = timeToMinutes(prevPeriod.open);
      const pClose = timeToMinutes(prevPeriod.close);
      if (pClose < pOpen && currentMinutes < pClose) {
        const closesAt = formatTimeBadge(prevPeriod.close);
        return {
          isOpen: true,
          badgeText: `Open Now · Closes ${closesAt}`,
          status: "open",
          closesAt,
          isAvailable: true,
        };
      }
    }

    // Check today's shift
    if (todayPeriod && !todayPeriod.closed && todayPeriod.open && todayPeriod.close) {
      const tOpen = timeToMinutes(todayPeriod.open);
      const tClose = timeToMinutes(todayPeriod.close);

      const isOpenNow =
        tClose < tOpen
          ? currentMinutes >= tOpen || currentMinutes < tClose
          : currentMinutes >= tOpen && currentMinutes < tClose;

      if (isOpenNow) {
        const closesAt = formatTimeBadge(todayPeriod.close);
        return {
          isOpen: true,
          badgeText: `Open Now · Closes ${closesAt}`,
          status: "open",
          closesAt,
          isAvailable: true,
        };
      }

      // If earlier today before opening
      if (currentMinutes < tOpen) {
        const opensAt = formatTimeBadge(todayPeriod.open);
        return {
          isOpen: false,
          badgeText: `Closed · Opens ${opensAt}`,
          status: "closed",
          opensAt,
          opensNext: `${opensAt} today`,
          isAvailable: true,
        };
      }
    }

    // Closed now and already past today's closing or closed today
    // Check tomorrow or future days
    const tomorrowPeriod = periods[tomorrowName];
    if (tomorrowPeriod && !tomorrowPeriod.closed && tomorrowPeriod.open) {
      const opensTomorrow = formatTimeBadge(tomorrowPeriod.open);
      return {
        isOpen: false,
        badgeText: `Closed · Opens ${opensTomorrow} tomorrow`,
        status: "closed",
        opensAt: opensTomorrow,
        opensNext: `${opensTomorrow} tomorrow`,
        isAvailable: true,
      };
    }

    // Check rest of the week
    for (let offset = 2; offset < 7; offset++) {
      const nextDayName = DAYS_OF_WEEK[(currentDayIdx + offset) % 7];
      const nextPeriod = periods[nextDayName];
      if (nextPeriod && !nextPeriod.closed && nextPeriod.open) {
        const opensNext = formatTimeBadge(nextPeriod.open);
        const dayLabel = nextDayName.charAt(0).toUpperCase() + nextDayName.slice(1);
        return {
          isOpen: false,
          badgeText: `Closed · Opens ${opensNext} ${dayLabel}`,
          status: "closed",
          opensAt: opensNext,
          opensNext: `${opensNext} ${dayLabel}`,
          isAvailable: true,
        };
      }
    }

    return {
      isOpen: false,
      badgeText: "Closed",
      status: "closed",
      isAvailable: true,
    };
  }

  // 3. Standard Text Time Range: e.g. "08:00 - 20:00", "08:00-20:00", "8:00 AM - 8:00 PM"
  const rangeMatch = trimmed.match(
    /(\d{1,2}:\d{2})\s*(?:-|–|to)\s*(\d{1,2}:\d{2})/i,
  );

  if (rangeMatch) {
    const rawOpen = rangeMatch[1];
    const rawClose = rangeMatch[2];
    const openMin = timeToMinutes(rawOpen);
    const closeMin = timeToMinutes(rawClose);

    // All day / 24-hour operating span
    if (openMin === closeMin || (openMin === 0 && closeMin === 1440)) {
      return {
        isOpen: true,
        badgeText: "Open 24 Hours",
        status: "24/7",
        is24Hours: true,
        isAvailable: true,
      };
    }

    // Overnight shift: e.g. 18:00 - 02:00
    if (closeMin < openMin) {
      const isOpen = currentMinutes >= openMin || currentMinutes < closeMin;
      if (isOpen) {
        const closesAt = formatTimeBadge(rawClose);
        return {
          isOpen: true,
          badgeText: `Open Now · Closes ${closesAt}`,
          status: "open",
          closesAt,
          isAvailable: true,
        };
      } else {
        const opensAt = formatTimeBadge(rawOpen);
        return {
          isOpen: false,
          badgeText: `Closed · Opens ${opensAt}`,
          status: "closed",
          opensAt,
          opensNext: `${opensAt} today`,
          isAvailable: true,
        };
      }
    }

    // Standard daylight shift: e.g. 08:00 - 20:00
    if (currentMinutes >= openMin && currentMinutes < closeMin) {
      const closesAt = formatTimeBadge(rawClose);
      return {
        isOpen: true,
        badgeText: `Open Now · Closes ${closesAt}`,
        status: "open",
        closesAt,
        isAvailable: true,
      };
    } else if (currentMinutes < openMin) {
      const opensAt = formatTimeBadge(rawOpen);
      return {
        isOpen: false,
        badgeText: `Closed · Opens ${opensAt}`,
        status: "closed",
        opensAt,
        opensNext: `${opensAt} today`,
        isAvailable: true,
      };
    } else {
      const opensAt = formatTimeBadge(rawOpen);
      return {
        isOpen: false,
        badgeText: `Closed · Opens ${opensAt} tomorrow`,
        status: "closed",
        opensAt,
        opensNext: `${opensAt} tomorrow`,
        isAvailable: true,
      };
    }
  }

  // 4. Fallback for unparseable but non-empty strings
  return {
    isOpen: false,
    badgeText: trimmed,
    status: "unknown",
    isAvailable: true,
  };
}
