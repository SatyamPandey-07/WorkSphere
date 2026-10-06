export interface DayPeriod {
  open: string;  // "09:00" local time
  close: string; // "18:00" local time
  closed: boolean;
}

export interface StructuredHours {
  timezone: string;
  periods: Record<string, DayPeriod>;
}

export const DEFAULT_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "America/Denver",
  "Europe/London",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

export const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/**
 * Parses the opening hours string. If it is structured JSON, returns the parsed object.
 * Otherwise, returns null.
 */
export function parseStructuredHours(hoursStr: string | null | undefined): StructuredHours | null {
  if (!hoursStr) return null;
  try {
    const parsed = JSON.parse(hoursStr);
    if (parsed && typeof parsed.timezone === "string" && parsed.periods) {
      return parsed as StructuredHours;
    }
  } catch {}
  return null;
}

/**
 * Formats a time string like "09:00" into 12-hour format "9:00 AM"
 */
export function formatTime12h(time24: string): string {
  if (!time24 || typeof time24 !== "string") return "";
  const parts = time24.trim().split(":");
  if (parts.length < 2) return time24;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return time24;
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  const displayM = String(m).padStart(2, "0");
  return `${displayH}:${displayM} ${ampm}`;
}

/**
 * Returns whether the venue is currently open, along with a human-readable display string
 */
export function getOpeningHoursStatus(
  hoursStr: string | null | undefined,
  timezoneOverride?: string,
  nowInput?: Date,
): {
  isOpen: boolean;
  displayString: string;
  isStructured: boolean;
} {
  const structured = parseStructuredHours(hoursStr);
  if (!structured) {
    return {
      isOpen: false,
      displayString: hoursStr || "Hours not available",
      isStructured: false,
    };
  }

  const timezone = timezoneOverride || structured.timezone;
  const now = nowInput || new Date();

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));

    const dayName = partMap.weekday ? partMap.weekday.toLowerCase() : "";
    const currentMinutes = Number(partMap.hour === "24" ? 0 : partMap.hour || 0) * 60 + Number(partMap.minute || 0);

    const period = structured.periods ? structured.periods[dayName] : undefined;
    const dayIdx = DAYS_OF_WEEK.indexOf(dayName);

    let isOpen = false;
    let overnightFromPrev = false;

    if (dayIdx !== -1 && structured.periods) {
      const prevName = DAYS_OF_WEEK[(dayIdx + 6) % 7];
      const prev = structured.periods[prevName];
      if (prev && !prev.closed && typeof prev.open === "string" && typeof prev.close === "string") {
        const [pOpenH, pOpenM] = prev.open.split(":").map(Number);
        const [pCloseH, pCloseM] = prev.close.split(":").map(Number);
        const pOpenMin = pOpenH * 60 + pOpenM;
        const pCloseMin = pCloseH * 60 + pCloseM;
        if (pCloseMin < pOpenMin && currentMinutes < pCloseMin) {
          isOpen = true;
          overnightFromPrev = true;
        }
      }
    }

    if (!isOpen && period && !period.closed && typeof period.open === "string" && typeof period.close === "string") {
      const [openH, openM] = period.open.split(":").map(Number);
      const [closeH, closeM] = period.close.split(":").map(Number);
      const openMin = openH * 60 + openM;
      const closeMin = closeH * 60 + closeM;

      if (closeMin < openMin) {
        isOpen = currentMinutes >= openMin || currentMinutes < closeMin;
      } else {
        isOpen = currentMinutes >= openMin && currentMinutes < closeMin;
      }
    }

    let displayString: string;
    if (period && !period.closed && typeof period.open === "string" && typeof period.close === "string") {
      displayString = `Today: ${formatTime12h(period.open)} - ${formatTime12h(period.close)} (${timezone})`;
    } else if (overnightFromPrev && dayIdx !== -1 && structured.periods) {
      const prevName = DAYS_OF_WEEK[(dayIdx + 6) % 7];
      const prev = structured.periods[prevName];
      displayString = prev?.close ? `Open until ${formatTime12h(prev.close)} (${timezone})` : `Closed Today (${timezone})`;
    } else {
      displayString = `Closed Today (${timezone})`;
    }

    return { isOpen, displayString, isStructured: true };
  } catch (error) {
    console.error("Error formatting timezone hours:", error);
    return {
      isOpen: false,
      displayString: "Hours conversion error",
      isStructured: true,
    };
  }
}
