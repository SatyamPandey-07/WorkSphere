/**
 * Tests for smart venue schedule optimization.
 */

interface ScheduleSlot {
  startMinutes: number;
  endMinutes: number;
  isBooked: boolean;
  revenue: number;
}

function findGapSlots(
  slots: ScheduleSlot[],
  minGapMinutes: number
): { startMinutes: number; endMinutes: number }[] {
  const sorted = [...slots].sort((a, b) => a.startMinutes - b.startMinutes);
  const gaps: { startMinutes: number; endMinutes: number }[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = sorted[i].endMinutes;
    const gapEnd = sorted[i + 1].startMinutes;
    const gapSize = gapEnd - gapStart;
    if (gapSize >= minGapMinutes) {
      gaps.push({ startMinutes: gapStart, endMinutes: gapEnd });
    }
  }

  return gaps;
}

function utilizationPercent(
  slots: ScheduleSlot[],
  openMinutes: number,
  closeMinutes: number
): number {
  const totalBookedMinutes = slots
    .filter((s) => s.isBooked)
    .reduce((sum, s) => sum + (s.endMinutes - s.startMinutes), 0);
  const totalMinutes = closeMinutes - openMinutes;
  if (totalMinutes <= 0) return 0;
  return Math.round((totalBookedMinutes / totalMinutes) * 100);
}

function optimalSlotLength(slots: ScheduleSlot[]): number | null {
  const booked = slots.filter((s) => s.isBooked);
  if (booked.length === 0) return null;
  const revPerMinute = booked.map((s) => s.revenue / (s.endMinutes - s.startMinutes));
  const avgIdx = revPerMinute.reduce((best, r, i) => r > revPerMinute[best] ? i : best, 0);
  return booked[avgIdx].endMinutes - booked[avgIdx].startMinutes;
}

const SLOTS: ScheduleSlot[] = [
  { startMinutes: 540, endMinutes: 660, isBooked: true,  revenue: 1000 }, // 9-11am
  { startMinutes: 720, endMinutes: 840, isBooked: true,  revenue: 800  }, // 12-2pm
  { startMinutes: 960, endMinutes: 1080,isBooked: false, revenue: 0    }, // 4-6pm (available)
];

describe("Smart venue schedule optimization", () => {
  it("findGapSlots: gap between 11am and noon = 60 min", () => {
    const gaps = findGapSlots(SLOTS, 30);
    expect(gaps.some((g) => g.startMinutes === 660 && g.endMinutes === 720)).toBe(true);
  });

  it("findGapSlots: min gap 90 → excludes 60-min gap", () => {
    const gaps = findGapSlots(SLOTS, 90);
    expect(gaps).toHaveLength(0);
  });

  it("utilizationPercent: 2 booked × 120 min = 240 of 540 total", () => {
    const pct = utilizationPercent(SLOTS, 540, 1080);
    expect(pct).toBeCloseTo(44, 0);
  });

  it("utilizationPercent: no booked slots → 0", () => {
    const none = SLOTS.map((s) => ({ ...s, isBooked: false }));
    expect(utilizationPercent(none, 540, 1080)).toBe(0);
  });

  it("optimalSlotLength: returns length of highest revenue/min slot", () => {
    const length = optimalSlotLength(SLOTS);
    expect(length).toBe(120);
  });

  it("optimalSlotLength: no bookings → null", () => {
    const none = SLOTS.map((s) => ({ ...s, isBooked: false }));
    expect(optimalSlotLength(none)).toBeNull();
  });
});
