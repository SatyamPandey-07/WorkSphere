/**
 * Tests for recurring booking pattern detection and management.
 */

type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sun

interface RecurringPattern {
  patternId: string;
  userId: string;
  venueId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  startDate: string;  // YYYY-MM-DD
  endDate: string | null; // null = indefinite
  frequencyWeeks: number; // 1=weekly, 2=biweekly
}

function getOccurrenceDates(
  pattern: RecurringPattern,
  fromDate: string,
  toDate: string
): string[] {
  const dates: string[] = [];
  const start = new Date(Math.max(new Date(pattern.startDate).getTime(), new Date(fromDate).getTime()));
  const end = new Date(toDate);
  const patternEnd = pattern.endDate ? new Date(pattern.endDate) : null;
  const intervalMs = pattern.frequencyWeeks * 7 * 86_400_000;

  // Find first occurrence on or after fromDate with correct day of week
  let current = new Date(start);
  while (current.getUTCDay() !== pattern.dayOfWeek) {
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Snap to pattern start date alignment
  const patternStart = new Date(pattern.startDate);
  const diffMs = current.getTime() - patternStart.getTime();
  const periods = Math.ceil(diffMs / intervalMs);
  current = new Date(patternStart.getTime() + periods * intervalMs);

  while (current <= end) {
    if (patternEnd && current > patternEnd) break;
    const dateStr = current.toISOString().split("T")[0];
    if (dateStr >= fromDate) dates.push(dateStr);
    current = new Date(current.getTime() + intervalMs);
  }

  return dates;
}

function isRecurringConflict(
  pattern: RecurringPattern,
  bookingDate: string,
  bookingStartTime: string,
  bookingEndTime: string
): boolean {
  const dayOfWeek = new Date(bookingDate).getUTCDay() as DayOfWeek;
  if (dayOfWeek !== pattern.dayOfWeek) return false;
  return bookingStartTime < pattern.endTime && bookingEndTime > pattern.startTime;
}

describe("Recurring booking patterns", () => {
  const PATTERN: RecurringPattern = {
    patternId: "p1", userId: "u1", venueId: "v1",
    dayOfWeek: 1, // Monday
    startTime: "09:00", endTime: "11:00",
    startDate: "2026-10-05", // Monday
    endDate: "2026-12-31",
    frequencyWeeks: 1,
  };

  it("getOccurrenceDates: weekly Monday for 3 weeks", () => {
    const dates = getOccurrenceDates(PATTERN, "2026-10-05", "2026-10-26");
    expect(dates.length).toBeGreaterThanOrEqual(3);
    expect(dates[0]).toBe("2026-10-05");
  });

  it("getOccurrenceDates: past endDate → no more occurrences", () => {
    const dates = getOccurrenceDates(PATTERN, "2027-01-01", "2027-02-01");
    expect(dates).toHaveLength(0);
  });

  it("isRecurringConflict: same day overlapping time → true", () => {
    expect(isRecurringConflict(PATTERN, "2026-10-05", "10:00", "12:00")).toBe(true);
  });

  it("isRecurringConflict: same day non-overlapping → false", () => {
    expect(isRecurringConflict(PATTERN, "2026-10-05", "11:00", "13:00")).toBe(false);
  });

  it("isRecurringConflict: different day → false", () => {
    expect(isRecurringConflict(PATTERN, "2026-10-06", "10:00", "12:00")).toBe(false);
  });
});
