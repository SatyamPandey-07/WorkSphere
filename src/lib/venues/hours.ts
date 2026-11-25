export type WeekdayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface DailyTimeWindow {
  open: string;
  close: string;
}

export interface VenueOpeningHours {
  timeZone?: string;
  is24Seven?: boolean;
  schedule?: Partial<Record<WeekdayKey, DailyTimeWindow[]>>;
}

export type VenueOpeningState = "open" | "closing_soon" | "closed" | "open_24_hours";

export interface VenueOpeningStatus {
  state: VenueOpeningState;
  badgeText: string;
  ariaLabel: string;
  is24Hours?: boolean;
  closesAtFormatted?: string;
  opensAtFormatted?: string;
  minutesRemaining?: number;
  countdownText?: string;
}

export const WEEKDAY_ORDER: WeekdayKey[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

export function resolveTimeZone(tz?: string): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return tz;
  } catch {
    return "UTC";
  }
}

export function parseMinutes(hhmm: string): number {
  if (!hhmm || typeof hhmm !== "string") return 0;
  const [hStr, mStr] = hhmm.trim().split(":");
  const hours = Number(hStr);
  const minutes = Number(mStr ?? "0");
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  if (hours === 24 && minutes === 0) return 1440;
  return Math.max(0, Math.min(1439, hours * 60 + minutes));
}

/**
 * Evaluates whether a daily window represents continuous 24-hour operation for that day.
 * Supported 24-hour patterns:
 * - open: "00:00" and close: "24:00" or "00:00"
 * - open equals close (e.g. "08:00" to "08:00")
 * - 0 to 1440 minutes span
 */
export function isWindow24Hours(win: DailyTimeWindow): boolean {
  if (!win || !win.open || !win.close) return false;
  const o = win.open.trim();
  const c = win.close.trim();
  if (o === "00:00" && (c === "24:00" || c === "00:00")) return true;
  if (o === c) return true;
  const openMin = parseMinutes(o);
  const closeMin = parseMinutes(c);
  return openMin === 0 && (closeMin === 0 || closeMin === 1440);
}

/**
 * Checks whether a venue operates 24 hours a day, 7 days a week.
 * Criteria:
 * 1. explicit `is24Seven: true` flag.
 * 2. or all 7 days of the week in `schedule` have defined windows and every day operates 24 hours continuously.
 */
export function isSchedule24Seven(openingHours?: VenueOpeningHours): boolean {
  if (!openingHours) return false;
  if (openingHours.is24Seven === true) return true;

  const schedule = openingHours.schedule;
  if (!schedule || typeof schedule !== "object") return false;

  // Must define all 7 days of the week
  for (const day of WEEKDAY_ORDER) {
    const windows = schedule[day];
    if (!Array.isArray(windows) || windows.length === 0) {
      return false;
    }
    // At least one window on that day must be 24-hour continuous
    const has24HourSpan = windows.some((win) => isWindow24Hours(win));
    if (!has24HourSpan) {
      return false;
    }
  }

  return true;
}

function getLocalClock(
  date: Date,
  timeZone: string,
): {
  weekdayIndex: number;
  minutesSinceMidnight: number;
} {
  const partsFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = partsFormatter.formatToParts(date);
  const weekdayShort = (parts.find((p) => p.type === "weekday")?.value ?? "Sun")
    .toLowerCase()
    .slice(0, 3) as WeekdayKey;
  const weekdayIndex = Math.max(0, WEEKDAY_ORDER.indexOf(weekdayShort));
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);

  return {
    weekdayIndex,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

export function formatMinutes12Hour(minutesFromMidnight: number): string {
  const normalized = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minStr = `:${String(mins).padStart(2, "0")}`;
  return `${h12}${minStr} ${period}`;
}

export function formatCountdown(
  minutes: number,
  prefix: "Closes in" | "Opens in",
): string {
  const clamped = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  if (hours === 0) {
    return `${prefix} ${mins}m`;
  }
  if (mins === 0) {
    return `${prefix} ${hours}h`;
  }
  return `${prefix} ${hours}h ${mins}m`;
}

interface ActiveInterval {
  startAbs: number;
  endAbs: number;
  closeMinutesOfDay: number;
}

function collectIntervals(
  openingHours: VenueOpeningHours,
  baseDayIndex: number,
): ActiveInterval[] {
  const schedule = openingHours.schedule ?? {};
  const intervals: ActiveInterval[] = [];

  for (let dayOffset = -1; dayOffset <= 7; dayOffset += 1) {
    const idx = (((baseDayIndex + dayOffset) % 7) + 7) % 7;
    const dayKey = WEEKDAY_ORDER[idx];
    const windows = schedule[dayKey] ?? [];
    const dayBaseMinutes = dayOffset * 1440;

    for (const win of windows) {
      const openMin = parseMinutes(win.open);
      let closeMin = parseMinutes(win.close);
      if (closeMin <= openMin) {
        closeMin += 1440;
      }

      const startAbs = dayBaseMinutes + openMin;
      const endAbs = dayBaseMinutes + closeMin;
      intervals.push({
        startAbs,
        endAbs,
        closeMinutesOfDay: ((closeMin % 1440) + 1440) % 1440,
      });
    }
  }

  return intervals.sort((a, b) => a.startAbs - b.startAbs);
}

export function getVenueOpeningStatus(
  openingHours: VenueOpeningHours = {},
  currentTime: Date | string | number = new Date(),
): VenueOpeningStatus {
  // Check 24/7 continuous operation first
  if (isSchedule24Seven(openingHours)) {
    return {
      state: "open_24_hours",
      badgeText: "Open 24 Hours",
      ariaLabel: "Venue is open 24 hours, operating 24/7",
      is24Hours: true,
    };
  }

  const nowDate =
    currentTime instanceof Date ? currentTime : new Date(currentTime);
  const timeZone = resolveTimeZone(openingHours.timeZone);
  const { weekdayIndex, minutesSinceMidnight } = getLocalClock(
    nowDate,
    timeZone,
  );
  const intervals = collectIntervals(openingHours, weekdayIndex);

  const active = intervals.find(
    (iv) =>
      minutesSinceMidnight >= iv.startAbs && minutesSinceMidnight < iv.endAbs,
  );

  if (active) {
    const minutesRemaining = active.endAbs - minutesSinceMidnight;
    const closesAtFormatted = formatMinutes12Hour(active.closeMinutesOfDay);
    const countdownText = formatCountdown(minutesRemaining, "Closes in");

    if (minutesRemaining < 60) {
      const badgeText = `Closing Soon (Closes at ${closesAtFormatted})`;
      return {
        state: "closing_soon",
        badgeText,
        ariaLabel: `Venue is ${badgeText}`,
        closesAtFormatted,
        minutesRemaining,
        countdownText,
      };
    }

    return {
      state: "open",
      badgeText: "Open Now",
      ariaLabel: `Venue is Open Now, closes at ${closesAtFormatted}`,
      closesAtFormatted,
      minutesRemaining,
      countdownText,
    };
  }

  const nextUpcoming = intervals.find(
    (iv) => iv.startAbs > minutesSinceMidnight,
  );
  if (nextUpcoming) {
    const minutesRemaining = nextUpcoming.startAbs - minutesSinceMidnight;
    const countdownText = formatCountdown(minutesRemaining, "Opens in");
    const opensAtFormatted = formatMinutes12Hour(nextUpcoming.startAbs);
    const dayDiff = Math.floor(nextUpcoming.startAbs / 1440);
    const dayPhrase =
      dayDiff === 0
        ? "today"
        : dayDiff === 1
          ? "tomorrow"
          : WEEKDAY_ORDER[(((weekdayIndex + dayDiff) % 7) + 7) % 7];

    const badgeText = `Closed (Opens ${dayPhrase} at ${opensAtFormatted})`;
    return {
      state: "closed",
      badgeText,
      ariaLabel: `Venue is ${badgeText}`,
      opensAtFormatted,
      minutesRemaining,
      countdownText,
    };
  }

  return {
    state: "closed",
    badgeText: "Closed",
    ariaLabel: "Venue is currently Closed",
  };
}
