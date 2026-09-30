/**
 * Tests for venue yield management (revenue optimization).
 */

interface YieldSlot {
  slotId: string;
  startHour: number;
  endHour: number;
  baseRateCents: number;
  minRateCents: number;
  maxRateCents: number;
  currentBookingPercent: number; // 0-100 fill rate
}

function yieldOptimizedRate(slot: YieldSlot): number {
  const fillRatio = slot.currentBookingPercent / 100;
  if (fillRatio >= 0.9) {
    return slot.maxRateCents;
  } else if (fillRatio >= 0.7) {
    const premium = Math.round((slot.maxRateCents - slot.baseRateCents) * (fillRatio - 0.7) / 0.2);
    return slot.baseRateCents + premium;
  } else if (fillRatio <= 0.3) {
    const discount = Math.round((slot.baseRateCents - slot.minRateCents) * (0.3 - fillRatio) / 0.3);
    return slot.baseRateCents - discount;
  }
  return slot.baseRateCents;
}

function totalYieldRevenue(slots: YieldSlot[], bookedSlots: string[]): number {
  return slots
    .filter((s) => bookedSlots.includes(s.slotId))
    .reduce((sum, s) => sum + yieldOptimizedRate(s), 0);
}

function revenuePerHour(slot: YieldSlot): number {
  const duration = slot.endHour - slot.startHour;
  if (duration <= 0) return 0;
  return Math.round(yieldOptimizedRate(slot) / duration);
}

const SLOTS: YieldSlot[] = [
  { slotId: "s1", startHour: 9,  endHour: 11, baseRateCents: 2000, minRateCents: 1000, maxRateCents: 3000, currentBookingPercent: 95 }, // high demand
  { slotId: "s2", startHour: 14, endHour: 16, baseRateCents: 2000, minRateCents: 1000, maxRateCents: 3000, currentBookingPercent: 50 }, // normal
  { slotId: "s3", startHour: 17, endHour: 19, baseRateCents: 2000, minRateCents: 1000, maxRateCents: 3000, currentBookingPercent: 10 }, // low demand
];

describe("Venue yield management", () => {
  it("yieldOptimizedRate: 95% fill → max rate (3000)", () => {
    expect(yieldOptimizedRate(SLOTS[0])).toBe(3000);
  });

  it("yieldOptimizedRate: 50% fill → base rate (2000)", () => {
    expect(yieldOptimizedRate(SLOTS[1])).toBe(2000);
  });

  it("yieldOptimizedRate: 10% fill → discounted", () => {
    expect(yieldOptimizedRate(SLOTS[2])).toBeLessThan(2000);
    expect(yieldOptimizedRate(SLOTS[2])).toBeGreaterThanOrEqual(1000);
  });

  it("totalYieldRevenue: sum of booked slot rates", () => {
    const revenue = totalYieldRevenue(SLOTS, ["s1", "s2"]);
    expect(revenue).toBe(3000 + 2000);
  });

  it("revenuePerHour: s1 peak = 3000/2h = 1500", () => {
    expect(revenuePerHour(SLOTS[0])).toBe(1500);
  });

  it("totalYieldRevenue: no booked slots → 0", () => {
    expect(totalYieldRevenue(SLOTS, [])).toBe(0);
  });
});
