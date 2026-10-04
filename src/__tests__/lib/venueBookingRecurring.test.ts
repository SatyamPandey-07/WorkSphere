/**
 * Tests for venue recurring booking schedule generation.
 */

type RecurrenceFreq = "daily" | "weekly" | "biweekly" | "monthly";

interface RecurrenceRule {
  frequency: RecurrenceFreq;
  startMs: number;
  endMs: number | null;       // null = indefinite
  maxOccurrences: number | null;
  daysOfWeek: number[];       // 0=Sun, for weekly/biweekly
  excludeDates: string[];     // YYYY-MM-DD
}

function nextOccurrenceMs(rule: RecurrenceRule, afterMs: number): number | null {
  const MS_PER_DAY = 86_400_000;
  const MS_PER_WEEK = 7 * MS_PER_DAY;
  let candidate = rule.startMs;

  while (candidate <= afterMs) {
    switch (rule.frequency) {
      case "daily":    candidate += MS_PER_DAY; break;
      case "weekly":   candidate += MS_PER_WEEK; break;
      case "biweekly": candidate += 2 * MS_PER_WEEK; break;
      case "monthly":  {
        const d = new Date(candidate);
        d.setUTCMonth(d.getUTCMonth() + 1);
        candidate = d.getTime();
        break;
      }
    }
  }

  if (rule.endMs !== null && candidate > rule.endMs) return null;
  const dateStr = new Date(candidate).toISOString().slice(0, 10);
  if (rule.excludeDates.includes(dateStr)) return nextOccurrenceMs(rule, candidate);
  return candidate;
}

function generateOccurrences(rule: RecurrenceRule, limit: number): number[] {
  const occurrences: number[] = [];
  let cursor = rule.startMs - 1;
  while (occurrences.length < limit) {
    const next = nextOccurrenceMs(rule, cursor);
    if (next === null) break;
    if (rule.maxOccurrences !== null && occurrences.length >= rule.maxOccurrences) break;
    occurrences.push(next);
    cursor = next;
  }
  return occurrences;
}

function occurrenceCount(rule: RecurrenceRule, fromMs: number, toMs: number): number {
  return generateOccurrences(rule, 1000).filter((ms) => ms >= fromMs && ms <= toMs).length;
}

// 2026-11-02 (Monday) 09:00 UTC
const MONDAY_9AM = 1762074000000;
const WEEK_MS = 7 * 86_400_000;

const WEEKLY_RULE: RecurrenceRule = {
  frequency: "weekly",
  startMs: MONDAY_9AM,
  endMs: MONDAY_9AM + 8 * WEEK_MS,
  maxOccurrences: null,
  daysOfWeek: [1], // Monday
  excludeDates: [],
};

describe("Recurring booking schedule generation", () => {
  it("nextOccurrenceMs: weekly, after start → next Monday", () => {
    const next = nextOccurrenceMs(WEEKLY_RULE, MONDAY_9AM);
    expect(next).toBe(MONDAY_9AM + WEEK_MS);
  });

  it("generateOccurrences: 4 weekly occurrences", () => {
    const occ = generateOccurrences(WEEKLY_RULE, 4);
    expect(occ.length).toBe(4);
  });

  it("generateOccurrences: each 7 days apart", () => {
    const occ = generateOccurrences(WEEKLY_RULE, 3);
    expect(occ[1] - occ[0]).toBe(WEEK_MS);
  });

  it("occurrenceCount: 8 weeks = 8 occurrences in window", () => {
    const count = occurrenceCount(WEEKLY_RULE, MONDAY_9AM, MONDAY_9AM + 8 * WEEK_MS);
    expect(count).toBe(8);
  });

  it("nextOccurrenceMs: returns null after endMs", () => {
    expect(nextOccurrenceMs(WEEKLY_RULE, MONDAY_9AM + 9 * WEEK_MS)).toBeNull();
  });
});
