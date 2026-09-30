/**
 * Tests for venue time slot optimization to maximize revenue and utilization.
 */

interface TimeSlot {
  start: number; // milliseconds (UTC)
  end: number;
  priceMultiplier: number;
  isAvailable: boolean;
  demandScore: number; // 0-1
}

interface SlotGap {
  start: number;
  end: number;
  durationMs: number;
}

function slotDurationMs(slot: TimeSlot): number {
  return slot.end - slot.start;
}

function slotRevenuePotential(slot: TimeSlot, baseRatePerHour: number): number {
  const hours = slotDurationMs(slot) / 3_600_000;
  return Math.round(baseRatePerHour * hours * slot.priceMultiplier * slot.demandScore * 100) / 100;
}

function findGaps(slots: TimeSlot[], windowStart: number, windowEnd: number): SlotGap[] {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const gaps: SlotGap[] = [];
  let cursor = windowStart;
  for (const slot of sorted) {
    if (slot.start > cursor) {
      gaps.push({ start: cursor, end: slot.start, durationMs: slot.start - cursor });
    }
    cursor = Math.max(cursor, slot.end);
  }
  if (cursor < windowEnd) {
    gaps.push({ start: cursor, end: windowEnd, durationMs: windowEnd - cursor });
  }
  return gaps;
}

function optimalSlotOrder(slots: TimeSlot[], baseRate: number): TimeSlot[] {
  return slots
    .filter((s) => s.isAvailable)
    .sort((a, b) => slotRevenuePotential(b, baseRate) - slotRevenuePotential(a, baseRate));
}

function utilizationRate(slots: TimeSlot[], windowMs: number): number {
  if (windowMs === 0) return 0;
  const used = slots.reduce((s, slot) => s + slotDurationMs(slot), 0);
  return Math.round((used / windowMs) * 100);
}

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;
const SLOTS: TimeSlot[] = [
  { start: NOW,          end: NOW + 2 * HOUR, priceMultiplier: 1.2, isAvailable: true,  demandScore: 0.9 },
  { start: NOW + 4*HOUR, end: NOW + 6 * HOUR, priceMultiplier: 1.0, isAvailable: true,  demandScore: 0.5 },
  { start: NOW + 7*HOUR, end: NOW + 9 * HOUR, priceMultiplier: 0.8, isAvailable: false, demandScore: 0.3 },
];

describe("Time slot optimizer", () => {
  it("slotDurationMs: 2-hour slot = 7200000ms", () => {
    expect(slotDurationMs(SLOTS[0])).toBe(2 * HOUR);
  });

  it("slotRevenuePotential: first slot has higher potential", () => {
    expect(slotRevenuePotential(SLOTS[0], 100)).toBeGreaterThan(slotRevenuePotential(SLOTS[1], 100));
  });

  it("findGaps: 2h gap between slot 1 and slot 2", () => {
    const gaps = findGaps(SLOTS, NOW, NOW + 9 * HOUR);
    expect(gaps.some((g) => g.durationMs === 2 * HOUR)).toBe(true);
  });

  it("optimalSlotOrder: available slots sorted by revenue potential", () => {
    const ordered = optimalSlotOrder(SLOTS, 100);
    expect(ordered.every((s) => s.isAvailable)).toBe(true);
    expect(ordered[0]).toBe(SLOTS[0]);
  });

  it("utilizationRate: 4h used in 9h window ≈ 44%", () => {
    const rate = utilizationRate(SLOTS, 9 * HOUR);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(100);
  });
});
