/**
 * Recurring booking date generation.
 *
 * Single source of truth shared by POST /api/reservations/recurring-book and
 * the reservation form's preview, so the dates a user is shown are always the
 * dates that are actually booked.
 *
 * All arithmetic is done on calendar components with Date.UTC and read back
 * with the UTC getters. Never mix in local-time methods (setDate/setMonth/...):
 * in a DST timezone a "T00:00:00Z" instant is not local midnight, so adding a
 * local day can move the instant across a UTC date boundary and repeat or skip
 * a date.
 */

import { isValidBookingDate } from "./dateTimeAdapter";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export const MAX_RECURRING_OCCURRENCES = 52;

/** Number of days in the given (0-based) month of `year`. */
function daysInMonthUTC(year: number, monthIndex: number): number {
  // Day 0 of the *next* month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Generates the ordered list of "YYYY-MM-DD" dates for a recurring series.
 *
 * - `daily` / `weekly` step by 1 / 7 calendar days from the start date.
 * - `monthly` keeps the start date's day-of-month, and clamps it to the last
 *   day of shorter months (Jan 31 -> Feb 28/29 -> Mar 31 -> Apr 30 ...).
 *   Every occurrence is derived from the original start date, never from the
 *   previous occurrence, so a clamped month does not permanently shift the
 *   series (Jan 31 -> Feb 28 must not become Mar 28, Apr 28, ...).
 * - The series stops at `endDate` (inclusive) or after `occurrences` dates,
 *   whichever comes first, and never exceeds MAX_RECURRING_OCCURRENCES.
 *
 * Returns [] for an invalid start date or an unknown frequency.
 */
export function generateRecurringDates(
  startDate: string,
  frequency: string,
  endDate: string | null = null,
  occurrences: number | null = null,
): string[] {
  if (!isValidBookingDate(startDate)) return [];
  if (
    frequency !== "daily" &&
    frequency !== "weekly" &&
    frequency !== "monthly"
  ) {
    return [];
  }

  const [y, m, d] = startDate.split("-").map(Number);
  const requested =
    typeof occurrences === "number" && Number.isFinite(occurrences)
      ? Math.floor(occurrences)
      : MAX_RECURRING_OCCURRENCES;
  const maxOccurrences = Math.min(requested, MAX_RECURRING_OCCURRENCES);
  const dates: string[] = [];

  for (let i = 0; dates.length < maxOccurrences; i++) {
    let next: Date;
    if (frequency === "daily") {
      next = new Date(Date.UTC(y, m - 1, d + i));
    } else if (frequency === "weekly") {
      next = new Date(Date.UTC(y, m - 1, d + 7 * i));
    } else {
      // Normalise the target year/month first (handles Dec -> Jan rollover),
      // then clamp the day so we never spill into the following month.
      const target = new Date(Date.UTC(y, m - 1 + i, 1));
      const year = target.getUTCFullYear();
      const monthIndex = target.getUTCMonth();
      next = new Date(
        Date.UTC(
          year,
          monthIndex,
          Math.min(d, daysInMonthUTC(year, monthIndex)),
        ),
      );
    }

    const dateStr = next.toISOString().slice(0, 10);
    if (endDate && dateStr > endDate) break;
    dates.push(dateStr);
  }

  return dates;
}
