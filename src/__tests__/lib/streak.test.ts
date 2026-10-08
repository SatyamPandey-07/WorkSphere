import {
  calculateStreak,
  getUnlockedMilestones,
  shiftDateString,
  todayUTC,
  yesterdayUTC,
  normalizeToUTCMidnight,
  getCalendarDayDifference,
} from "@/lib/streak";

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Returns a "YYYY-MM-DD" UTC string N days before today */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── todayUTC / yesterdayUTC ──────────────────────────────────────────────────

describe("todayUTC", () => {
  it("returns a YYYY-MM-DD formatted string", () => {
    expect(todayUTC()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("yesterdayUTC", () => {
  it("returns a YYYY-MM-DD formatted string", () => {
    expect(yesterdayUTC()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is one day before today", () => {
    const today = new Date(todayUTC());
    const yesterday = new Date(yesterdayUTC());
    const diff = today.getTime() - yesterday.getTime();
    expect(diff).toBe(24 * 60 * 60 * 1000);
  });

  it("respects the user timezone instead of UTC on local midnight boundaries", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-01-01T23:30:00-08:00"));

    expect(todayUTC("America/Los_Angeles")).toBe("2024-01-01");
    expect(yesterdayUTC("America/Los_Angeles")).toBe("2023-12-31");

    jest.useRealTimers();
  });
});

// ─── calculateStreak ──────────────────────────────────────────────────────────

describe("calculateStreak", () => {
  // ── First ever check-in ────────────────────────────────────────────────────
  describe("first ever check-in (null lastCheckInDate)", () => {
    it("sets streak to 1", () => {
      const result = calculateStreak(null, 0, 0);
      expect(result.currentStreak).toBe(1);
    });

    it("sets longestStreak to 1", () => {
      const result = calculateStreak(null, 0, 0);
      expect(result.longestStreak).toBe(1);
    });

    it("sets incremented to true", () => {
      const result = calculateStreak(null, 0, 0);
      expect(result.incremented).toBe(true);
    });

    it("sets lastCheckInDate to today", () => {
      const result = calculateStreak(null, 0, 0);
      expect(result.lastCheckInDate).toBe(todayUTC());
    });
  });

  // ── Same-day duplicate ─────────────────────────────────────────────────────
  describe("same-day duplicate check-in", () => {
    it("does not increment streak", () => {
      const result = calculateStreak(todayUTC(), 5, 5);
      expect(result.currentStreak).toBe(5);
    });

    it("sets incremented to false", () => {
      const result = calculateStreak(todayUTC(), 5, 5);
      expect(result.incremented).toBe(false);
    });

    it("does not change longestStreak", () => {
      const result = calculateStreak(todayUTC(), 5, 10);
      expect(result.longestStreak).toBe(10);
    });

    it("returns no new milestones", () => {
      const result = calculateStreak(todayUTC(), 4, 4);
      expect(result.newMilestones).toHaveLength(0);
    });

    it("ignores the UTC day boundary when the user is still on the same local day", () => {
      jest.useFakeTimers().setSystemTime(new Date("2024-01-01T23:30:00-08:00"));

      const result = calculateStreak("2024-01-01", 4, 4, "America/Los_Angeles");
      expect(result.incremented).toBe(false);
      expect(result.currentStreak).toBe(4);

      jest.useRealTimers();
    });
  });

  // ── Consecutive day ────────────────────────────────────────────────────────
  describe("consecutive day check-in (yesterday)", () => {
    it("increments streak by 1", () => {
      const result = calculateStreak(yesterdayUTC(), 7, 7);
      expect(result.currentStreak).toBe(8);
    });

    it("sets incremented to true", () => {
      const result = calculateStreak(yesterdayUTC(), 7, 7);
      expect(result.incremented).toBe(true);
    });

    it("updates longestStreak when current exceeds it", () => {
      const result = calculateStreak(yesterdayUTC(), 12, 12);
      expect(result.longestStreak).toBe(13);
    });

    it("does not decrease longestStreak", () => {
      const result = calculateStreak(yesterdayUTC(), 3, 20);
      expect(result.longestStreak).toBe(20);
    });
  });

  // ── Streak reset ───────────────────────────────────────────────────────────
  describe("streak reset (gap > 1 day)", () => {
    it("resets streak to 1 after a 2-day gap", () => {
      const result = calculateStreak(daysAgo(2), 15, 15);
      expect(result.currentStreak).toBe(1);
    });

    it("resets streak to 1 after a week gap", () => {
      const result = calculateStreak(daysAgo(7), 30, 30);
      expect(result.currentStreak).toBe(1);
    });

    it("sets incremented to true on reset (new day)", () => {
      const result = calculateStreak(daysAgo(3), 10, 10);
      expect(result.incremented).toBe(true);
    });

    it("preserves longestStreak on reset", () => {
      const result = calculateStreak(daysAgo(5), 8, 25);
      expect(result.longestStreak).toBe(25);
    });
  });

  // ── Milestone detection ────────────────────────────────────────────────────
  describe("milestone detection", () => {
    it("unlocks 5-day milestone when streak reaches 5", () => {
      const result = calculateStreak(yesterdayUTC(), 4, 4);
      expect(result.newMilestones).toContain(5);
    });

    it("unlocks 10-day milestone when streak reaches 10", () => {
      const result = calculateStreak(yesterdayUTC(), 9, 9);
      expect(result.newMilestones).toContain(10);
    });

    it("unlocks 30-day milestone when streak reaches 30", () => {
      const result = calculateStreak(yesterdayUTC(), 29, 29);
      expect(result.newMilestones).toContain(30);
    });

    it("does not re-unlock 5-day milestone when already past it", () => {
      const result = calculateStreak(yesterdayUTC(), 6, 6);
      expect(result.newMilestones).not.toContain(5);
    });

    it("does not re-award previously unlocked milestone on streak recovery", () => {
      // User previously reached a 10-day streak, broke it, and recovered back to 5 days
      const result = calculateStreak(yesterdayUTC(), 4, 10);
      expect(result.currentStreak).toBe(5);
      expect(result.newMilestones).toHaveLength(0);
      expect(result.newMilestones).not.toContain(5);
    });

    it("does not unlock a milestone on same-day duplicate", () => {
      const result = calculateStreak(todayUTC(), 4, 4);
      expect(result.newMilestones).toHaveLength(0);
    });

    it("returns empty newMilestones when no threshold crossed", () => {
      const result = calculateStreak(yesterdayUTC(), 2, 2);
      expect(result.newMilestones).toHaveLength(0);
    });
  });
});

// ─── getUnlockedMilestones ────────────────────────────────────────────────────

describe("getUnlockedMilestones", () => {
  it("returns empty array for streak of 0", () => {
    expect(getUnlockedMilestones(0)).toHaveLength(0);
  });

  it("returns [5] for streak of 5", () => {
    expect(getUnlockedMilestones(5)).toEqual([5]);
  });

  it("returns [5, 10] for streak of 10", () => {
    expect(getUnlockedMilestones(10)).toEqual([5, 10]);
  });

  it("returns [5, 10] for streak of 15", () => {
    expect(getUnlockedMilestones(15)).toEqual([5, 10]);
  });

  it("returns [5, 10, 30] for streak of 30", () => {
    expect(getUnlockedMilestones(30)).toEqual([5, 10, 30]);
  });

  it("returns [5, 10, 30] for streak above 30", () => {
    expect(getUnlockedMilestones(45)).toEqual([5, 10, 30]);
  });
});

// ─── DST regression tests ─────────────────────────────────────────────────────
// A local day is 23h (spring forward) or 25h (fall back) on DST transitions, so
// "yesterday" must come from calendar arithmetic, not "now minus 24 hours".

describe("shiftDateString", () => {
  it("shifts across month, year and leap-day boundaries", () => {
    expect(shiftDateString("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftDateString("2024-01-01", -1)).toBe("2023-12-31");
    expect(shiftDateString("2023-12-31", 1)).toBe("2024-01-01");
  });
});

describe("yesterdayUTC across DST transitions", () => {
  it("returns the previous local day the day after US spring-forward", () => {
    // 2024-03-10 was 23h long in New York (clocks 02:00 -> 03:00).
    const now = new Date("2024-03-11T00:30:00-04:00");
    expect(todayUTC("America/New_York", now)).toBe("2024-03-11");
    expect(yesterdayUTC("America/New_York", now)).toBe("2024-03-10");
  });

  it("returns the previous local day late on a US fall-back (25h) day", () => {
    // 2024-11-03 was 25h long in New York (clocks 02:00 -> 01:00).
    const now = new Date("2024-11-03T23:30:00-05:00");
    expect(todayUTC("America/New_York", now)).toBe("2024-11-03");
    expect(yesterdayUTC("America/New_York", now)).toBe("2024-11-02");
  });

  it("handles southern-hemisphere spring-forward (Sydney)", () => {
    // 2024-10-06 was 23h long in Sydney.
    const now = new Date("2024-10-07T00:30:00+11:00");
    expect(todayUTC("Australia/Sydney", now)).toBe("2024-10-07");
    expect(yesterdayUTC("Australia/Sydney", now)).toBe("2024-10-06");
  });

  it("is unaffected in zones without DST", () => {
    const now = new Date("2024-03-11T00:30:00+05:30");
    expect(yesterdayUTC("Asia/Kolkata", now)).toBe("2024-03-10");
  });
});

describe("calculateStreak across DST transitions", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps the streak when checking in just after midnight following spring-forward", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-03-11T00:30:00-04:00"));

    const result = calculateStreak("2024-03-10", 6, 9, "America/New_York");
    expect(result.incremented).toBe(true);
    expect(result.currentStreak).toBe(7);
    expect(result.longestStreak).toBe(9);
  });

  it("keeps the streak late in the evening of a fall-back day", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-11-03T23:30:00-05:00"));

    const result = calculateStreak("2024-11-02", 4, 4, "America/New_York");
    expect(result.incremented).toBe(true);
    expect(result.currentStreak).toBe(5);
    expect(result.newMilestones).toEqual([5]);
  });

  it("still resets the streak after a genuinely missed local day", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-03-12T09:00:00-04:00"));

    const result = calculateStreak("2024-03-10", 6, 9, "America/New_York");
    expect(result.currentStreak).toBe(1);
  });

  it("respects the injected now Date parameter without relying on system clock", () => {
    const injectedNow = new Date("2025-05-15T10:00:00Z");
    const resultConsecutive = calculateStreak(
      "2025-05-14",
      3,
      5,
      "UTC",
      injectedNow,
    );
    expect(resultConsecutive.incremented).toBe(true);
    expect(resultConsecutive.currentStreak).toBe(4);
    expect(resultConsecutive.lastCheckInDate).toBe("2025-05-15");

    const resultSameDay = calculateStreak(
      "2025-05-15",
      4,
      5,
      "UTC",
      injectedNow,
    );
    expect(resultSameDay.incremented).toBe(false);
    expect(resultSameDay.currentStreak).toBe(4);
  });

  it("preserves streaks across leap day transitions (Feb 28 -> Feb 29 -> Mar 1 in 2024)", () => {
    // Check-in on Feb 28, 2024
    const feb28Now = new Date("2024-02-28T14:00:00Z");
    const streakFeb28 = calculateStreak(null, 0, 0, "UTC", feb28Now);
    expect(streakFeb28.currentStreak).toBe(1);
    expect(streakFeb28.lastCheckInDate).toBe("2024-02-28");

    // Check-in on Feb 29, 2024 (Leap Day)
    const feb29Now = new Date("2024-02-29T16:30:00Z");
    const streakFeb29 = calculateStreak("2024-02-28", 1, 1, "UTC", feb29Now);
    expect(streakFeb29.incremented).toBe(true);
    expect(streakFeb29.currentStreak).toBe(2);
    expect(streakFeb29.lastCheckInDate).toBe("2024-02-29");

    // Check-in on Mar 1, 2024
    const mar01Now = new Date("2024-03-01T09:15:00Z");
    const streakMar01 = calculateStreak("2024-02-29", 2, 2, "UTC", mar01Now);
    expect(streakMar01.incremented).toBe(true);
    expect(streakMar01.currentStreak).toBe(3);
    expect(streakMar01.lastCheckInDate).toBe("2024-03-01");
  });
});

// ─── normalizeToUTCMidnight & getCalendarDayDifference ───────────────────────

describe("normalizeToUTCMidnight", () => {
  it("normalizes Date objects with arbitrary hours to UTC midnight", () => {
    const d = new Date("2024-02-29T23:59:59.999Z");
    const normalized = normalizeToUTCMidnight(d);
    expect(normalized.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });

  it("normalizes YYYY-MM-DD date strings to UTC midnight", () => {
    const normalized = normalizeToUTCMidnight("2024-02-29");
    expect(normalized.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });
});

describe("getCalendarDayDifference", () => {
  it("returns 1 for consecutive days across leap day (Feb 28 to Feb 29 in 2024)", () => {
    expect(getCalendarDayDifference("2024-02-28", "2024-02-29")).toBe(1);
    expect(getCalendarDayDifference("2024-02-29", "2024-03-01")).toBe(1);
  });

  it("returns 1 for consecutive days across Feb 28 to Mar 1 in non-leap year (2023)", () => {
    expect(getCalendarDayDifference("2023-02-28", "2023-03-01")).toBe(1);
  });

  it("returns 0 for same calendar day", () => {
    expect(getCalendarDayDifference("2024-02-29", "2024-02-29")).toBe(0);
  });

  it("returns > 1 for skipped calendar days", () => {
    expect(getCalendarDayDifference("2024-02-28", "2024-03-01")).toBe(2);
  });
});
