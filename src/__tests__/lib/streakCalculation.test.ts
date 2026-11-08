/**
 * Tests for user streak calculation logic.
 *
 * Covers: empty date array, single date, consecutive days,
 * gap resets streak, and max streak tracked separately from current.
 * Self-contained — no external imports beyond Jest globals.
 */

// ─── Minimal streak calculator used only by these tests ──────────────────────

interface StreakResult {
  currentStreak: number;
  maxStreak: number;
}

/**
 * Given an array of ISO date strings (YYYY-MM-DD) in any order,
 * compute the current streak (consecutive days ending today or yesterday)
 * and the maximum streak ever seen in the data.
 */
function calculateStreakFromDates(
  dates: string[],
  today: string
): StreakResult {
  if (dates.length === 0) return { currentStreak: 0, maxStreak: 0 };

  // Deduplicate and sort ascending
  const sorted = Array.from(new Set(dates)).sort();

  let maxStreak = 1;
  let runLength = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffDays =
      (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays === 1) {
      runLength++;
      if (runLength > maxStreak) maxStreak = runLength;
    } else {
      runLength = 1;
    }
  }

  // Current streak: how many consecutive days end at today (or yesterday)
  const lastDate = sorted[sorted.length - 1];
  const todayD = new Date(today);
  const lastD = new Date(lastDate);
  const lagDays =
    (todayD.getTime() - lastD.getTime()) / (1000 * 60 * 60 * 24);

  // If the last check-in was more than 1 day ago, current streak is 0
  if (lagDays > 1) return { currentStreak: 0, maxStreak };

  // Walk backwards from the last date
  let current = 1;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = new Date(sorted[i]);
    const b = new Date(sorted[i + 1]);
    const diff = (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 1) current++;
    else break;
  }

  return { currentStreak: current, maxStreak };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const TODAY = "2025-06-10";

describe("calculateStreakFromDates", () => {
  describe("empty dates", () => {
    it("returns currentStreak of 0 for an empty array", () => {
      const { currentStreak } = calculateStreakFromDates([], TODAY);
      expect(currentStreak).toBe(0);
    });

    it("returns maxStreak of 0 for an empty array", () => {
      const { maxStreak } = calculateStreakFromDates([], TODAY);
      expect(maxStreak).toBe(0);
    });
  });

  describe("single date", () => {
    it("returns currentStreak of 1 when the only date is today", () => {
      const { currentStreak } = calculateStreakFromDates([TODAY], TODAY);
      expect(currentStreak).toBe(1);
    });

    it("returns currentStreak of 1 when the only date is yesterday", () => {
      const { currentStreak } = calculateStreakFromDates(
        ["2025-06-09"],
        TODAY
      );
      expect(currentStreak).toBe(1);
    });

    it("returns maxStreak of 1 for a single date", () => {
      const { maxStreak } = calculateStreakFromDates([TODAY], TODAY);
      expect(maxStreak).toBe(1);
    });
  });

  describe("consecutive days", () => {
    it("returns currentStreak equal to the number of consecutive days", () => {
      const dates = [
        "2025-06-08",
        "2025-06-09",
        TODAY, // 2025-06-10
      ];
      const { currentStreak } = calculateStreakFromDates(dates, TODAY);
      expect(currentStreak).toBe(3);
    });

    it("handles a longer streak of 5 consecutive days", () => {
      const dates = [
        "2025-06-06",
        "2025-06-07",
        "2025-06-08",
        "2025-06-09",
        TODAY,
      ];
      const { currentStreak } = calculateStreakFromDates(dates, TODAY);
      expect(currentStreak).toBe(5);
    });

    it("is not affected by duplicate date entries", () => {
      const dates = ["2025-06-09", "2025-06-09", TODAY, TODAY];
      const { currentStreak } = calculateStreakFromDates(dates, TODAY);
      expect(currentStreak).toBe(2);
    });
  });

  describe("gap resets streak", () => {
    it("returns currentStreak of 1 when there is a gap before the last date", () => {
      // gap between Jun 7 and Jun 9
      const dates = ["2025-06-07", "2025-06-09", TODAY];
      const { currentStreak } = calculateStreakFromDates(dates, TODAY);
      expect(currentStreak).toBe(2);
    });

    it("returns currentStreak of 0 when the last entry was 2 days ago", () => {
      const dates = ["2025-06-06", "2025-06-08"]; // last is Jun 8, today Jun 10
      const { currentStreak } = calculateStreakFromDates(dates, TODAY);
      expect(currentStreak).toBe(0);
    });
  });

  describe("maxStreak tracked separately from currentStreak", () => {
    it("maxStreak reflects a past longer streak even if current streak is short", () => {
      // Past 5-day streak, then a gap, then 1 day today
      const dates = [
        "2025-05-01",
        "2025-05-02",
        "2025-05-03",
        "2025-05-04",
        "2025-05-05",
        TODAY, // isolated day
      ];
      const { currentStreak, maxStreak } = calculateStreakFromDates(
        dates,
        TODAY
      );
      expect(currentStreak).toBe(1);
      expect(maxStreak).toBe(5);
    });

    it("maxStreak equals currentStreak when the longest run ends today", () => {
      const dates = ["2025-06-08", "2025-06-09", TODAY];
      const { currentStreak, maxStreak } = calculateStreakFromDates(
        dates,
        TODAY
      );
      expect(currentStreak).toBe(3);
      expect(maxStreak).toBe(3);
    });
  });
});
