/**
 * streak.ts
 *
 * Pure streak-calculation logic, isolated so it can be unit-tested
 * without any database or Next.js dependencies.
 */

/** Milestone thresholds (days) that earn a badge */
export const STREAK_MILESTONES = [5, 10, 30] as const;
export type StreakMilestone = (typeof STREAK_MILESTONES)[number];

/** Returns the date in a given timezone as a "YYYY-MM-DD" string */
export function dateInTimeZone(date: Date, timeZone: string = "UTC"): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const parts = formatter.formatToParts(date);
    const map = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;

    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return new Date(date.toISOString()).toISOString().slice(0, 10);
  }
}

/** Returns today's date as a "YYYY-MM-DD" string in the supplied timezone */
export function todayUTC(timeZone: string = "UTC", now: Date = new Date()): string {
  return dateInTimeZone(now, timeZone);
}

/**
 * Shifts a "YYYY-MM-DD" calendar date by a whole number of days.
 *
 * This is pure calendar arithmetic (done at UTC midnight, which has no DST), so
 * it is independent of any timezone's UTC offset.
 */
export function shiftDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Returns yesterday's date as a "YYYY-MM-DD" string in the supplied timezone.
 *
 * Yesterday must be derived from the user's *local calendar date*, not by
 * subtracting 24 hours from the current instant: on a DST transition a local
 * day is 23 or 25 hours long, so "now - 24h" can land two calendar days back
 * (spring forward) or on today's date (fall back), wrongly breaking streaks.
 */
export function yesterdayUTC(timeZone: string = "UTC", now: Date = new Date()): string {
  return shiftDateString(dateInTimeZone(now, timeZone), -1);
}

export interface StreakResult {
  /** New current streak value after this check-in */
  currentStreak: number;
  /** New longest streak value (never decreases) */
  longestStreak: number;
  /** "YYYY-MM-DD" UTC date to persist */
  lastCheckInDate: string;
  /**
   * true  → streak was incremented (new day)
   * false → same-day duplicate, nothing changed
   */
  incremented: boolean;
  /** Milestones newly unlocked by this check-in */
  newMilestones: StreakMilestone[];
}

/**
 * Normalizes a Date object or "YYYY-MM-DD" string to UTC midnight (00:00:00.000Z).
 *
 * Prevents timezone offset shifts and daylight saving time duration variances (23h / 25h days)
 * from corrupting calendar day calculations.
 */
export function normalizeToUTCMidnight(date: Date | string): Date {
  if (typeof date === "string") {
    const [year, month, day] = date.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Computes the exact calendar day difference between two dates by normalizing both to UTC midnight.
 *
 * Guarantees accurate 1-day step calculations across leap years (Feb 28 -> Feb 29 / Mar 1)
 * and DST transitions (23-hour spring forward and 25-hour fall back days).
 */
export function getCalendarDayDifference(d1: Date | string, d2: Date | string): number {
  const utc1 = normalizeToUTCMidnight(d1);
  const utc2 = normalizeToUTCMidnight(d2);
  const diffMs = utc2.getTime() - utc1.getTime();
  return Math.round(diffMs / 86400000);
}

/**
 * calculateStreak
 *
 * Determines the new streak values when a user performs a daily check-in.
 *
 * Rules:
 * - Same day as lastCheckInDate → no-op (returns incremented: false)
 * - Consecutive day (1 calendar day delta normalized to UTC midnight) → streak + 1
 * - Any gap > 1 day → streak resets to 1
 *
 * @param lastCheckInDate  Stored "YYYY-MM-DD" UTC string, or null for first-ever
 * @param currentStreak    Current streak count stored in DB
 * @param longestStreak    All-time longest streak stored in DB
 */
export function calculateStreak(
  lastCheckInDate: string | null,
  currentStreak: number,
  longestStreak: number,
  timeZone: string = "UTC",
  now: Date = new Date(),
): StreakResult {
  // Sample the clock once so "today" and "yesterday" can never straddle midnight.
  const today = todayUTC(timeZone, now);
  const yesterday = yesterdayUTC(timeZone, now);

  // ── Same-day duplicate ──────────────────────────────────────────────────
  if (lastCheckInDate === today || (lastCheckInDate && getCalendarDayDifference(lastCheckInDate, today) === 0)) {
    return {
      currentStreak,
      longestStreak,
      lastCheckInDate: today,
      incremented: false,
      newMilestones: [],
    };
  }

  // ── Determine new streak ────────────────────────────────────────────────
  const isConsecutive =
    lastCheckInDate === yesterday ||
    (lastCheckInDate !== null && getCalendarDayDifference(lastCheckInDate, today) === 1);

  const newStreak = isConsecutive
    ? currentStreak + 1 // consecutive day
    : 1; // first check-in ever, or gap reset

  const newLongest = Math.max(longestStreak, newStreak);

  // ── Milestone detection ─────────────────────────────────────────────────
  // A milestone is "newly unlocked" if the streak has never reached this threshold
  // before (longestStreak < milestone, newStreak >= milestone).
  const newMilestones = STREAK_MILESTONES.filter(
    (m) => newStreak >= m && longestStreak < m,
  );

  return {
    currentStreak: newStreak,
    longestStreak: newLongest,
    lastCheckInDate: today,
    incremented: true,
    newMilestones,
  };
}

/**
 * getUnlockedMilestones
 *
 * Returns every milestone already unlocked for a given streak count.
 * Used by the UI to render badge states on load.
 */
export function getUnlockedMilestones(streak: number): StreakMilestone[] {
  return STREAK_MILESTONES.filter((m) => streak >= m);
}
