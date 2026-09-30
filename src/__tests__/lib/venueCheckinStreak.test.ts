/**
 * Tests for user check-in streak at venues.
 */

function computeStreak(checkinDates: string[]): number {
  // dates are YYYY-MM-DD strings, sorted ascending
  if (checkinDates.length === 0) return 0;
  const sorted = [...new Set(checkinDates)].sort();
  let streak = 1;
  let maxStreak = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffMs = curr.getTime() - prev.getTime();
    const diffDays = Math.round(diffMs / 86_400_000);
    if (diffDays === 1) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 1;
    }
  }
  return maxStreak;
}

function currentStreak(checkinDates: string[], todayStr: string): number {
  const sorted = [...new Set(checkinDates)].sort().reverse();
  if (sorted.length === 0) return 0;
  let streak = 0;
  let expected = new Date(todayStr);

  for (const d of sorted) {
    const date = new Date(d);
    const diffDays = Math.round((expected.getTime() - date.getTime()) / 86_400_000);
    if (diffDays === 0 || (streak === 0 && diffDays === 0)) {
      streak++;
      expected = new Date(date);
      expected.setDate(expected.getDate() - 1);
    } else if (diffDays === 1 && streak > 0) {
      streak++;
      expected = new Date(date);
      expected.setDate(expected.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

describe("Venue check-in streak", () => {
  it("empty checkins → 0", () => {
    expect(computeStreak([])).toBe(0);
  });

  it("single checkin → streak 1", () => {
    expect(computeStreak(["2026-09-01"])).toBe(1);
  });

  it("consecutive 3 days → streak 3", () => {
    expect(computeStreak(["2026-09-01", "2026-09-02", "2026-09-03"])).toBe(3);
  });

  it("gap breaks streak", () => {
    expect(computeStreak(["2026-09-01", "2026-09-03"])).toBe(1);
  });

  it("longest streak among multiple runs", () => {
    const dates = ["2026-09-01", "2026-09-02", "2026-09-05", "2026-09-06", "2026-09-07"];
    expect(computeStreak(dates)).toBe(3);
  });

  it("deduplicates same-day checkins", () => {
    expect(computeStreak(["2026-09-01", "2026-09-01", "2026-09-02"])).toBe(2);
  });

  it("currentStreak: 0 when today has no checkin", () => {
    expect(currentStreak(["2026-09-01"], "2026-09-03")).toBe(0);
  });

  it("currentStreak: today included starts streak", () => {
    expect(currentStreak(["2026-09-28", "2026-09-29", "2026-09-30"], "2026-09-30")).toBe(3);
  });
});
