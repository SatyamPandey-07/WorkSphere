export interface PassExpirationInput {
  startDate: Date | string | number;
  durationDays: number;
  venueTimezone?: string;
}

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

const VALID_TIMEZONE_CACHE = new Map<string, boolean>();

export function isValidIanaTimezone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  const cached = VALID_TIMEZONE_CACHE.get(timeZone);
  if (cached !== undefined) return cached;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    VALID_TIMEZONE_CACHE.set(timeZone, true);
    return true;
  } catch {
    VALID_TIMEZONE_CACHE.set(timeZone, false);
    return false;
  }
}

function getDatePartsInTimezone(date: Date, timeZone: string): CalendarDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);

  return { year, month, day };
}

function getTimezoneOffsetMs(utcTimestampMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(new Date(utcTimestampMs));
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const second = Number(parts.find((p) => p.type === 'second')?.value);

  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const truncatedUtcMs = Math.floor(utcTimestampMs / 1000) * 1000;
  return asUtcMs - truncatedUtcMs;
}

export function calculatePassExpiration(
  startDate: Date | string | number,
  durationDays = 1,
  venueTimezone = 'UTC'
): Date {
  const parsedStart = startDate instanceof Date ? startDate : new Date(startDate);
  if (Number.isNaN(parsedStart.getTime())) {
    throw new Error('Invalid startDate provided to calculatePassExpiration');
  }

  const safeDays = Math.max(1, Math.floor(Number.isFinite(durationDays) ? durationDays : 1));
  const resolvedTimezone = isValidIanaTimezone(venueTimezone) ? venueTimezone : 'UTC';

  const startLocalParts = getDatePartsInTimezone(parsedStart, resolvedTimezone);
  const targetEndDayUtc = new Date(
    Date.UTC(startLocalParts.year, startLocalParts.month - 1, startLocalParts.day + (safeDays - 1))
  );

  const targetYear = targetEndDayUtc.getUTCFullYear();
  const targetMonth = targetEndDayUtc.getUTCMonth();
  const targetDay = targetEndDayUtc.getUTCDate();

  const naiveUtcMs = Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999);

  const initialOffsetMs = getTimezoneOffsetMs(naiveUtcMs, resolvedTimezone);
  let resolvedUtcMs = naiveUtcMs - initialOffsetMs;
  const refinedOffsetMs = getTimezoneOffsetMs(resolvedUtcMs, resolvedTimezone);
  if (refinedOffsetMs !== initialOffsetMs) {
    resolvedUtcMs = naiveUtcMs - refinedOffsetMs;
  }

  return new Date(resolvedUtcMs);
}

/**
 * Calculates the next upcoming Monday strictly following a given reference date.
 *
 * Rules:
 * - Sunday (0): returns the immediately following Monday (+1 day).
 * - Monday (1): returns the following week's Monday (+7 days), NOT the current day.
 * - Tuesday (2) through Saturday (6): returns the upcoming Monday (8 - dayOfWeek days).
 *
 * Deterministic and pure: does not mutate the reference Date and correctly handles
 * month boundaries, leap years, and year transitions.
 */
export function getNextMonday(referenceDate: Date = new Date()): Date {
  const ref = referenceDate instanceof Date && !isNaN(referenceDate.getTime())
    ? referenceDate
    : new Date();

  const year = ref.getFullYear();
  const month = ref.getMonth();
  const date = ref.getDate();
  const dayOfWeek = ref.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  // Days until next Monday:
  // Sun (0) -> 1
  // Mon (1) -> 7 (next week's Monday)
  // Tue (2) -> 6
  // Wed (3) -> 5
  // Thu (4) -> 4
  // Fri (5) -> 3
  // Sat (6) -> 2
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;

  return new Date(year, month, date + daysUntilMonday);
}
