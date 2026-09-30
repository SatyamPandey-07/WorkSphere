/**
 * Tests for venue staff rota (shift scheduling) management.
 */

interface Shift {
  staffId: string;
  role: string;
  startMs: number;
  endMs: number;
  breakMinutes: number;
}

function shiftHours(shift: Shift): number {
  return Math.round(((shift.endMs - shift.startMs) / 3_600_000 - shift.breakMinutes / 60) * 100) / 100;
}

function overlapsShift(a: Shift, b: Shift): boolean {
  return a.staffId === b.staffId && a.startMs < b.endMs && b.startMs < a.endMs;
}

function weeklyHours(staffId: string, shifts: Shift[]): number {
  return Math.round(
    shifts
      .filter((s) => s.staffId === staffId)
      .reduce((sum, s) => sum + shiftHours(s), 0) * 100
  ) / 100;
}

function overtimeHours(staffId: string, shifts: Shift[], standardWeek = 40): number {
  const worked = weeklyHours(staffId, shifts);
  return Math.max(0, Math.round((worked - standardWeek) * 100) / 100);
}

function understaffedSlots(shifts: Shift[], requiredPerSlot: number, slotMs: number[]): number[] {
  return slotMs.filter((slot) => {
    const count = shifts.filter((s) => s.startMs <= slot && slot < s.endMs).length;
    return count < requiredPerSlot;
  });
}

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const SHIFTS: Shift[] = [
  { staffId: "s1", role: "host",    startMs: NOW,          endMs: NOW + 8 * HOUR, breakMinutes: 30 },
  { staffId: "s1", role: "host",    startMs: NOW + 24*HOUR,endMs: NOW + 32*HOUR,  breakMinutes: 30 },
  { staffId: "s2", role: "cleaner", startMs: NOW + HOUR,   endMs: NOW + 5 * HOUR, breakMinutes: 0 },
];

describe("Venue staff rota management", () => {
  it("shiftHours: 8h shift with 30min break = 7.5h", () => {
    expect(shiftHours(SHIFTS[0])).toBe(7.5);
  });

  it("overlapsShift: same staff, overlapping → true", () => {
    const a: Shift = { staffId: "s1", role: "host", startMs: NOW, endMs: NOW + 4 * HOUR, breakMinutes: 0 };
    const b: Shift = { staffId: "s1", role: "host", startMs: NOW + 2 * HOUR, endMs: NOW + 6 * HOUR, breakMinutes: 0 };
    expect(overlapsShift(a, b)).toBe(true);
  });

  it("overlapsShift: different staff → false", () => {
    const a: Shift = { staffId: "s1", role: "host", startMs: NOW, endMs: NOW + 4 * HOUR, breakMinutes: 0 };
    const b: Shift = { staffId: "s2", role: "host", startMs: NOW, endMs: NOW + 4 * HOUR, breakMinutes: 0 };
    expect(overlapsShift(a, b)).toBe(false);
  });

  it("weeklyHours: s1 has 15h across two shifts", () => {
    expect(weeklyHours("s1", SHIFTS)).toBe(15);
  });

  it("overtimeHours: no overtime for 15h week", () => {
    expect(overtimeHours("s1", SHIFTS)).toBe(0);
  });

  it("understaffedSlots: returns slots with fewer than required", () => {
    const slots = [NOW, NOW + 2 * HOUR, NOW + 6 * HOUR];
    const understaffed = understaffedSlots(SHIFTS, 2, slots);
    expect(understaffed.length).toBeGreaterThan(0);
  });
});
