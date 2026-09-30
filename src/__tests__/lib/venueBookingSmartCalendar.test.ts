/**
 * Tests for smart calendar event scheduling.
 */

interface CalendarSlot {
  slotId: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  isBlocked: boolean;
  blockReason?: string;
}

interface SmartScheduleRequest {
  durationMinutes: number;
  preferredDays: number[];   // 0-6 (0=Sun)
  preferredHours: number[];  // preferred start hours
  flexibilityDays: number;   // how many days to look ahead
}

function findBestSlot(
  availableSlots: CalendarSlot[],
  request: SmartScheduleRequest,
  fromDate: string
): CalendarSlot | null {
  const dayOrder = request.preferredDays.length > 0
    ? request.preferredDays
    : [1, 2, 3, 4, 5]; // default weekdays

  const eligibleSlots = availableSlots
    .filter((s) =>
      !s.isBlocked &&
      s.endMinutes - s.startMinutes >= request.durationMinutes &&
      s.date >= fromDate
    )
    .sort((a, b) => {
      // Sort by preferred day of week, then preferred hour
      const aDow = new Date(a.date).getUTCDay();
      const bDow = new Date(b.date).getUTCDay();
      const aPref = dayOrder.indexOf(aDow);
      const bPref = dayOrder.indexOf(bDow);
      const aPreference = aPref === -1 ? 99 : aPref;
      const bPreference = bPref === -1 ? 99 : bPref;
      if (aPreference !== bPreference) return aPreference - bPreference;

      const aHourPref = request.preferredHours.indexOf(Math.floor(a.startMinutes / 60));
      const bHourPref = request.preferredHours.indexOf(Math.floor(b.startMinutes / 60));
      const aHP = aHourPref === -1 ? 99 : aHourPref;
      const bHP = bHourPref === -1 ? 99 : bHourPref;
      return aHP - bHP;
    });

  return eligibleSlots[0] ?? null;
}

function slotsOnDate(slots: CalendarSlot[], date: string): CalendarSlot[] {
  return slots.filter((s) => s.date === date && !s.isBlocked);
}

function totalAvailableMinutes(slots: CalendarSlot[], date: string): number {
  return slotsOnDate(slots, date).reduce((s, slot) => s + (slot.endMinutes - slot.startMinutes), 0);
}

const SLOTS: CalendarSlot[] = [
  { slotId: "s1", date: "2026-10-05", startMinutes: 540, endMinutes: 720, isBlocked: false }, // Mon 9-12
  { slotId: "s2", date: "2026-10-05", startMinutes: 840, endMinutes: 1020,isBlocked: false }, // Mon 2-5pm
  { slotId: "s3", date: "2026-10-06", startMinutes: 540, endMinutes: 900, isBlocked: false }, // Tue 9am-3pm
  { slotId: "s4", date: "2026-10-07", startMinutes: 540, endMinutes: 720, isBlocked: true,  blockReason: "Maintenance" },
];

describe("Smart calendar scheduling", () => {
  it("findBestSlot: prefers Monday (day 1) for Monday-first request", () => {
    const request: SmartScheduleRequest = { durationMinutes: 60, preferredDays: [1], preferredHours: [9], flexibilityDays: 7 };
    const slot = findBestSlot(SLOTS, request, "2026-10-05");
    expect(slot!.date).toBe("2026-10-05");
  });

  it("findBestSlot: skips blocked slots", () => {
    const request: SmartScheduleRequest = { durationMinutes: 60, preferredDays: [3], preferredHours: [9], flexibilityDays: 7 };
    const slot = findBestSlot(SLOTS, request, "2026-10-07");
    expect(slot).toBeNull(); // only Wed slot is blocked
  });

  it("slotsOnDate: 2 slots on Monday", () => {
    expect(slotsOnDate(SLOTS, "2026-10-05")).toHaveLength(2);
  });

  it("totalAvailableMinutes: Mon = 180+180 = 360 min", () => {
    expect(totalAvailableMinutes(SLOTS, "2026-10-05")).toBe(360);
  });

  it("totalAvailableMinutes: blocked day → 0", () => {
    expect(totalAvailableMinutes(SLOTS, "2026-10-07")).toBe(0);
  });
});
