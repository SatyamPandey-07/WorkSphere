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
export function todayUTC(timeZone: string = "UTC"): string {
  return dateInTimeZone(new Date(), timeZone);
}

/** Returns yesterday's date as a "YYYY-MM-DD" string in the supplied timezone */
export function yesterdayUTC(timeZone: string = "UTC"): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return dateInTimeZone(d, timeZone);
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
 * calculateStreak
 *
 * Determines the new streak values when a user performs a daily check-in.
 *
 * Rules:
 * - Same day as lastCheckInDate → no-op (returns incremented: false)
 * - Consecutive day (yesterday === lastCheckInDate) → streak + 1
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
): StreakResult {
  const today = todayUTC(timeZone);
  const yesterday = yesterdayUTC(timeZone);

  // ── Same-day duplicate ──────────────────────────────────────────────────
  if (lastCheckInDate === today) {
    return {
      currentStreak,
      longestStreak,
      lastCheckInDate: today,
      incremented: false,
      newMilestones: [],
    };
  }

  // ── Determine new streak ────────────────────────────────────────────────
  const newStreak =
    lastCheckInDate === yesterday
      ? currentStreak + 1 // consecutive day
      : 1; // first check-in ever, or gap reset

  const newLongest = Math.max(longestStreak, newStreak);

  // ── Milestone detection ─────────────────────────────────────────────────
  // A milestone is "newly unlocked" if the streak just crossed the threshold
  // from below (previous streak < milestone, new streak >= milestone).
  const newMilestones = STREAK_MILESTONES.filter(
    (m) => newStreak >= m && currentStreak < m,
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
