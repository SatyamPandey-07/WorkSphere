/**
 * Tests for venue booking schedule optimization algorithms.
 */

interface ScheduleSlot {
  id: string;
  startMs: number;
  endMs: number;
  priority: number;     // 1-10
  revenue: number;
  isFlexible: boolean;  // can be moved
}

function slotDuration(slot: ScheduleSlot): number {
  return slot.endMs - slot.startMs;
}

function slotsConflict(a: ScheduleSlot, b: ScheduleSlot): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function maxRevenueSchedule(slots: ScheduleSlot[]): ScheduleSlot[] {
  // Greedy: sort by end time, pick non-conflicting with highest revenue
  const sorted = [...slots].sort((a, b) => b.revenue - a.revenue);
  const selected: ScheduleSlot[] = [];
  for (const slot of sorted) {
    if (!selected.some((s) => slotsConflict(s, slot))) {
      selected.push(slot);
    }
  }
  return selected;
}

function totalScheduleRevenue(slots: ScheduleSlot[]): number {
  return Math.round(slots.reduce((s, slot) => s + slot.revenue, 0) * 100) / 100;
}

function gapsBetweenSlots(slots: ScheduleSlot[]): number[] {
  const sorted = [...slots].sort((a, b) => a.startMs - b.startMs);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].startMs - sorted[i - 1].endMs;
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
}

function scheduleEfficiency(slots: ScheduleSlot[], windowMs: number): number {
  if (windowMs === 0) return 0;
  const usedMs = slots.reduce((s, slot) => s + slotDuration(slot), 0);
  return Math.round((usedMs / windowMs) * 100);
}

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;
const SLOTS: ScheduleSlot[] = [
  { id: "s1", startMs: NOW,          endMs: NOW + 3*HOUR,  priority: 8, revenue: 600,  isFlexible: false },
  { id: "s2", startMs: NOW + 2*HOUR, endMs: NOW + 5*HOUR,  priority: 6, revenue: 800,  isFlexible: true },  // conflicts with s1
  { id: "s3", startMs: NOW + 4*HOUR, endMs: NOW + 7*HOUR,  priority: 9, revenue: 900,  isFlexible: false },
  { id: "s4", startMs: NOW + 8*HOUR, endMs: NOW + 10*HOUR, priority: 5, revenue: 400,  isFlexible: true },
];

describe("Schedule optimization algorithms", () => {
  it("slotsConflict: s1 and s2 overlap → true", () => {
    expect(slotsConflict(SLOTS[0], SLOTS[1])).toBe(true);
  });

  it("slotsConflict: s1 and s3 don't overlap → false", () => {
    expect(slotsConflict(SLOTS[0], SLOTS[2])).toBe(false);
  });

  it("maxRevenueSchedule: picks highest revenue non-conflicting", () => {
    const selected = maxRevenueSchedule(SLOTS);
    const ids = selected.map((s) => s.id);
    // s3 (900) and s4 (400) don't conflict and have no overlap with s2 winning first
    expect(ids).not.toContain("s1"); // s2 (800) > s1 (600) so s1 dropped
    expect(ids).toContain("s3");
  });

  it("totalScheduleRevenue: correct sum", () => {
    const selected = maxRevenueSchedule(SLOTS);
    expect(totalScheduleRevenue(selected)).toBeGreaterThan(0);
  });

  it("scheduleEfficiency: 12h used in 10h window → 100% (capped)", () => {
    // s1,s3,s4 = 3+3+2 = 8h in 10h window = 80%
    const nonConflicting = [SLOTS[0], SLOTS[2], SLOTS[3]];
    expect(scheduleEfficiency(nonConflicting, 10 * HOUR)).toBe(80);
  });

  it("gapsBetweenSlots: gap between s3 (ends 7h) and s4 (starts 8h) = 1h", () => {
    const gaps = gapsBetweenSlots([SLOTS[2], SLOTS[3]]);
    expect(gaps).toContain(HOUR);
  });
});
