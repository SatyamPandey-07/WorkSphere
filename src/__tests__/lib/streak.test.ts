import { calculateStreak, getUnlockedMilestones, todayUTC, yesterdayUTC } from "@/lib/streak";

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
