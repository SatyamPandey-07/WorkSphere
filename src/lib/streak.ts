/**
 * streak.ts
 *
 * Pure streak-calculation logic, isolated so it can be unit-tested
 * without any database or Next.js dependencies.
 */

/** Milestone thresholds (days) that earn a badge */
export const STREAK_MILESTONES = [5, 10, 30] as const;
export type StreakMilestone = (typeof STREAK_MILESTONES)[number];

/** Returns today's date as a "YYYY-MM-DD" UTC string */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns yesterday's date as a "YYYY-MM-DD" UTC string */
export function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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
): StreakResult {
  const today = todayUTC();
  const yesterday = yesterdayUTC();

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
