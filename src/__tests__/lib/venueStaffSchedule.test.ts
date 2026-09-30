/**
 * Tests for venue staff scheduling and coverage.
 */

type ShiftType = "morning" | "afternoon" | "evening" | "overnight";

interface StaffShift {
  staffId: string;
  venueId: string;
  date: string;      // YYYY-MM-DD
  shiftType: ShiftType;
  startHour: number; // 0-23
  endHour: number;   // 0-23
}

const SHIFT_HOURS: Record<ShiftType, { start: number; end: number }> = {
  morning:   { start: 6,  end: 14 },
  afternoon: { start: 14, end: 22 },
  evening:   { start: 18, end: 2  },  // crosses midnight (simplified)
  overnight: { start: 22, end: 6  },
};

function shiftDuration(shift: StaffShift): number {
  let hours = shift.endHour - shift.startHour;
  if (hours <= 0) hours += 24; // handle overnight
  return hours;
}

function staffOnDate(shifts: StaffShift[], venueId: string, date: string): StaffShift[] {
  return shifts.filter((s) => s.venueId === venueId && s.date === date);
}

function hasMinimumCoverage(
  shifts: StaffShift[],
  venueId: string,
  date: string,
  minStaff: number
): boolean {
  return staffOnDate(shifts, venueId, date).length >= minStaff;
}

function uniqueStaff(shifts: StaffShift[], venueId: string, date: string): string[] {
  return [...new Set(staffOnDate(shifts, venueId, date).map((s) => s.staffId))];
}

const SHIFTS: StaffShift[] = [
  { staffId: "e1", venueId: "v1", date: "2026-10-01", shiftType: "morning",   startHour: 6,  endHour: 14 },
  { staffId: "e2", venueId: "v1", date: "2026-10-01", shiftType: "afternoon", startHour: 14, endHour: 22 },
  { staffId: "e3", venueId: "v1", date: "2026-10-01", shiftType: "morning",   startHour: 6,  endHour: 14 },
  { staffId: "e4", venueId: "v2", date: "2026-10-01", shiftType: "morning",   startHour: 6,  endHour: 14 },
];

describe("Venue staff schedule", () => {
  it("shiftDuration: 6-14 = 8 hours", () => {
    expect(shiftDuration(SHIFTS[0])).toBe(8);
  });

  it("shiftDuration: overnight 22-6 = 8 hours", () => {
    const overnight: StaffShift = { ...SHIFTS[0], startHour: 22, endHour: 6 };
    expect(shiftDuration(overnight)).toBe(8);
  });

  it("staffOnDate: v1 on Oct 1 = 3 shifts", () => {
    expect(staffOnDate(SHIFTS, "v1", "2026-10-01")).toHaveLength(3);
  });

  it("staffOnDate: different date → 0", () => {
    expect(staffOnDate(SHIFTS, "v1", "2026-10-02")).toHaveLength(0);
  });

  it("hasMinimumCoverage: v1 has 3 >= 2 → true", () => {
    expect(hasMinimumCoverage(SHIFTS, "v1", "2026-10-01", 2)).toBe(true);
  });

  it("hasMinimumCoverage: v1 < 4 → false", () => {
    expect(hasMinimumCoverage(SHIFTS, "v1", "2026-10-01", 4)).toBe(false);
  });

  it("uniqueStaff: v1 has 3 unique staff members", () => {
    expect(uniqueStaff(SHIFTS, "v1", "2026-10-01")).toHaveLength(3);
  });
});
