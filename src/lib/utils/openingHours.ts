export interface OpeningHoursPeriod {
  open: string;
  close: string;
  closed?: boolean;
}

export interface StructuredOpeningHours {
  timezone?: string;
  periods: Record<string, OpeningHoursPeriod>;
}

export type VenueOpeningStatusKind =
  | "open"
  | "closing-soon"
  | "closed"
  | "24-7"
  | "unavailable";

export interface NextOpening {
  dayLabel: string;
  time: string;
  text: string;
  date: Date;
}

export interface VenueOpeningStatus {
  kind: VenueOpeningStatusKind;
  text: string;
  closingTime?: string;
  remainingMinutes?: number;
  nextOpening?: NextOpening;
  timezone: string;
}

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const VALID_TIME = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

export function resolveVenueTimezone(
  timezone?: string | null,
  fallback = "UTC",
): string {
  if (!timezone?.trim()) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return fallback;
  }
}

export function parseVenueOpeningHours(
  hours?: string | null,
): StructuredOpeningHours | null {
  if (!hours?.trim()) return null;
  try {
    const parsed = JSON.parse(hours);
    if (!parsed || typeof parsed !== "object") return null;

    if (parsed.periods && typeof parsed.periods === "object") {
      return {
        timezone: typeof parsed.timezone === "string" ? parsed.timezone : undefined,
        periods: parsed.periods as Record<string, OpeningHoursPeriod>,
      };
    }

    if (DAYS.some((day) => day in parsed)) {
      const periods: Record<string, OpeningHoursPeriod> = {};
      for (const day of DAYS) {
        if (parsed[day] && typeof parsed[day] === "object") {
          periods[day] = parsed[day] as OpeningHoursPeriod;
        }
      }
      return {
        timezone: typeof parsed.timezone === "string" ? parsed.timezone : undefined,
        periods,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseOpeningTime(raw: string): number | null {
  const match = raw.trim().match(VALID_TIME);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridian = match[3]?.toLowerCase();

  if (meridian === "am") {
    if (hours === 12) hours = 0;
  } else if (meridian === "pm") {
    if (hours < 12) hours += 12;
  } else if (hours === 24 && minutes === 0) {
    return 1440;
  }

  if (
    hours < 0 ||
    hours > 24 ||
    minutes < 0 ||
    minutes > 59 ||
    (hours === 24 && minutes !== 0)
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

export function formatOpeningTime(raw: string): string {
  const minutes = parseOpeningTime(raw);
  if (minutes === null) return raw;
  const normalized = minutes === 1440 ? 0 : minutes;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const meridian = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return mins === 0
    ? `${displayHour} ${meridian}`
    : `${displayHour}:${String(mins).padStart(2, "0")} ${meridian}`;
}

export function formatRemainingTime(minutes: number): string {
  const rounded = Math.max(0, Math.ceil(minutes));
  if (rounded < 60) return `${rounded}m`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

export function is24HourSchedule(hours?: string | null): boolean {
  if (!hours?.trim()) return false;
  const normalized = hours.trim().toLowerCase();
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

function is24HourPeriod(period?: OpeningHoursPeriod): boolean {
  if (!period || period.closed || !period.open || !period.close) return false;
  const open = parseOpeningTime(period.open);
  const close = parseOpeningTime(period.close);
  if (open === null || close === null) return false;
  return (
    (open === 0 && (close === 0 || close === 1440)) ||
    (open === close && open !== 0)
  );
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour === "24" ? 0 : values.hour || 0);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: String(values.weekday || "").toLowerCase(),
    minuteOfDay: hour * 60 + Number(values.minute || 0),
  };
}

function addCalendarDays(year: number, month: number, day: number, offset: number) {
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timezone: string,
): Date {
  const target = Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  let guess = target;

  for (let index = 0; index < 4; index += 1) {
    const zoned = zonedParts(new Date(guess), timezone);
    const zonedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      Math.floor(zoned.minuteOfDay / 60),
      zoned.minuteOfDay % 60,
      0,
    );
    const adjustment = target - zonedAsUtc;
    guess += adjustment;
    if (adjustment === 0) break;
  }

  return new Date(guess);
}

function unavailableStatus(timezone: string): VenueOpeningStatus {
  return {
    kind: "unavailable",
    text: "Hours unavailable",
    timezone,
  };
}

function parseLegacyRange(hours: string): {
  open: number;
  close: number;
  openRaw: string;
  closeRaw: string;
} | null {
  const match = hours.match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2})\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2})/i,
  );
  if (!match) return null;

  const openRaw = match[1].trim();
  const closeRaw = match[2].trim();
  const open = parseOpeningTime(openRaw);
  const close = parseOpeningTime(closeRaw);
  if (open === null || close === null) return null;
  return { open, close, openRaw, closeRaw };
}

function remainingFromInstant(
  now: Date,
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timezone: string,
): number {
  const closeInstant = wallTimeToInstant(
    year,
    month,
    day,
    minuteOfDay,
    timezone,
  );
  return Math.max(0, (closeInstant.getTime() - now.getTime()) / 60000);
}

function buildOpenStatus(
  now: Date,
  timezone: string,
  year: number,
  month: number,
  day: number,
  closeMinutes: number,
  closingTimeRaw: string,
): VenueOpeningStatus {
  const remaining = remainingFromInstant(
    now,
    year,
    month,
    day,
    closeMinutes,
    timezone,
  );
  const closingTime = formatOpeningTime(closingTimeRaw);
  const kind = remaining <= 45 ? "closing-soon" : "open";
  const countdown = formatRemainingTime(remaining);
  return {
    kind,
    text:
      kind === "closing-soon"
        ? `Closing soon • Closes at ${closingTime} (in ${countdown})`
        : `Open now • Closes at ${closingTime} (in ${countdown})`,
    closingTime,
    remainingMinutes: remaining,
    timezone,
  };
}

export function getVenueOpeningStatus(
  hours?: string | null,
  nowInput?: Date,
  timezoneOverride?: string | null,
): VenueOpeningStatus {
  if (!hours?.trim()) return unavailableStatus("UTC");

  const now =
    nowInput instanceof Date && !isNaN(nowInput.getTime())
      ? nowInput
      : new Date();

  if (is24HourSchedule(hours)) {
    return {
      kind: "24-7",
      text: "Open 24 hours",
      timezone: resolveVenueTimezone(timezoneOverride),
    };
  }

  const structured = parseVenueOpeningHours(hours);
  let timezone = resolveVenueTimezone(
    timezoneOverride ||
      structured?.timezone ||
      undefined,
  );

  let parts: ReturnType<typeof zonedParts>;
  try {
    parts = zonedParts(now, timezone);
  } catch {
    timezone = "UTC";
    parts = zonedParts(now, timezone);
  }

  const currentDayIndex = DAYS.indexOf(
    parts.weekday as (typeof DAYS)[number],
  );
  if (currentDayIndex === -1) return unavailableStatus(timezone);

  if (structured?.periods) {
    const periods = structured.periods;
    const todayName = DAYS[currentDayIndex];
    const previousName = DAYS[(currentDayIndex + 6) % 7];
    const today = periods[todayName];
    const previous = periods[previousName];

    if (previous && !previous.closed) {
      const previousOpen = parseOpeningTime(previous.open);
      const previousClose = parseOpeningTime(previous.close);
      if (
        previousOpen !== null &&
        previousClose !== null &&
        previousClose < previousOpen &&
        parts.minuteOfDay < previousClose
      ) {
        return buildOpenStatus(
          now,
          timezone,
          parts.year,
          parts.month,
          parts.day,
          previousClose,
          previous.close,
        );
      }
    }

    if (today && !today.closed) {
      const open = parseOpeningTime(today.open);
      const close = parseOpeningTime(today.close);
      if (open !== null && close !== null) {
        if (is24HourPeriod(today)) {
          return { kind: "24-7", text: "Open 24 hours", timezone };
        }

        const isOpen =
          close < open
            ? parts.minuteOfDay >= open || parts.minuteOfDay < close
            : parts.minuteOfDay >= open && parts.minuteOfDay < close;

        if (isOpen) {
          const closeDay =
            close < open && parts.minuteOfDay >= open
              ? addCalendarDays(parts.year, parts.month, parts.day, 1)
              : { year: parts.year, month: parts.month, day: parts.day };
          return buildOpenStatus(
            now,
            timezone,
            closeDay.year,
            closeDay.month,
            closeDay.day,
            close,
            today.close,
          );
        }

        if (parts.minuteOfDay < open) {
          const openInstant = wallTimeToInstant(
            parts.year,
            parts.month,
            parts.day,
            open,
            timezone,
          );
          return {
            kind: "closed",
            text: `Closed • Opens today at ${formatOpeningTime(today.open)}`,
            nextOpening: {
              dayLabel: "today",
              time: formatOpeningTime(today.open),
              text: `today at ${formatOpeningTime(today.open)}`,
              date: openInstant,
            },
            timezone,
          };
        }
      }
    }

    for (let offset = 1; offset <= 7; offset += 1) {
      const next = addCalendarDays(
        parts.year,
        parts.month,
        parts.day,
        offset,
      );
      const nextDayIndex = (currentDayIndex + offset) % 7;
      const nextName = DAYS[nextDayIndex];
      const nextPeriod = periods[nextName];
      if (
        nextPeriod &&
        !nextPeriod.closed &&
        parseOpeningTime(nextPeriod.open) !== null
      ) {
        const openMinutes = parseOpeningTime(nextPeriod.open)!;
        const openInstant = wallTimeToInstant(
          next.year,
          next.month,
          next.day,
          openMinutes,
          timezone,
        );
        const time = formatOpeningTime(nextPeriod.open);
        const dayLabel =
          offset === 1
            ? "tomorrow"
            : nextName.charAt(0).toUpperCase() + nextName.slice(1);
        return {
          kind: "closed",
          text: `Closed • Opens ${dayLabel} at ${time}`,
          nextOpening: {
            dayLabel,
            time,
            text: `${dayLabel} at ${time}`,
            date: openInstant,
          },
          timezone,
        };
      }
    }

    return unavailableStatus(timezone);
  }

  const range = parseLegacyRange(hours);
  if (!range) return unavailableStatus(timezone);

  if (range.close === range.open || (range.open === 0 && range.close === 1440)) {
    return { kind: "24-7", text: "Open 24 hours", timezone };
  }

  if (range.close < range.open) {
    if (parts.minuteOfDay >= range.open) {
      const closeDay = addCalendarDays(
        parts.year,
        parts.month,
        parts.day,
        1,
      );
      return buildOpenStatus(
        now,
        timezone,
        closeDay.year,
        closeDay.month,
        closeDay.day,
        range.close,
        range.closeRaw,
      );
    }
    if (parts.minuteOfDay < range.close) {
      return buildOpenStatus(
        now,
        timezone,
        parts.year,
        parts.month,
        parts.day,
        range.close,
        range.closeRaw,
      );
    }
    if (parts.minuteOfDay < range.open) {
      const openInstant = wallTimeToInstant(
        parts.year,
        parts.month,
        parts.day,
        range.open,
        timezone,
      );
      return {
        kind: "closed",
        text: `Closed • Opens today at ${formatOpeningTime(range.openRaw)}`,
        nextOpening: {
          dayLabel: "today",
          time: formatOpeningTime(range.openRaw),
          text: `today at ${formatOpeningTime(range.openRaw)}`,
          date: openInstant,
        },
        timezone,
      };
    }
  } else {
    if (
      parts.minuteOfDay >= range.open &&
      parts.minuteOfDay < range.close
    ) {
      return buildOpenStatus(
        now,
        timezone,
        parts.year,
        parts.month,
        parts.day,
        range.close,
        range.closeRaw,
      );
    }
    if (parts.minuteOfDay < range.open) {
      const openInstant = wallTimeToInstant(
        parts.year,
        parts.month,
        parts.day,
        range.open,
        timezone,
      );
      return {
        kind: "closed",
        text: `Closed • Opens today at ${formatOpeningTime(range.openRaw)}`,
        nextOpening: {
          dayLabel: "today",
          time: formatOpeningTime(range.openRaw),
          text: `today at ${formatOpeningTime(range.openRaw)}`,
          date: openInstant,
        },
        timezone,
      };
    }
  }

  const openInstant = wallTimeToInstant(
    parts.year,
    parts.month,
    parts.day,
    range.open,
    timezone,
  );
  const tomorrow = addCalendarDays(
    parts.year,
    parts.month,
    parts.day,
    1,
  );
  const tomorrowInstant = wallTimeToInstant(
    tomorrow.year,
    tomorrow.month,
    tomorrow.day,
    range.open,
    timezone,
  );
  void openInstant;
  return {
    kind: "closed",
    text: `Closed • Opens tomorrow at ${formatOpeningTime(range.openRaw)}`,
    nextOpening: {
      dayLabel: "tomorrow",
      time: formatOpeningTime(range.openRaw),
      text: `tomorrow at ${formatOpeningTime(range.openRaw)}`,
      date: tomorrowInstant,
    },
    timezone,
  };
}
