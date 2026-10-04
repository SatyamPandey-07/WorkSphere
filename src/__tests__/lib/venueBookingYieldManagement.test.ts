/**
 * Tests for venue yield management and revenue optimization.
 */

interface YieldSlot {
  date: string;
  hour: number;
  baseRate: number;
  demandMultiplier: number;  // 0.5–2.5
  occupancyRate: number;     // 0-1
  competitorRate: number;
}

interface YieldStrategy {
  minRate: number;
  maxRate: number;
  targetOccupancy: number;  // ideal occupancy (e.g. 0.8 = 80%)
  priceElasticity: number;  // demand sensitivity to price
}

function yieldRate(slot: YieldSlot, strategy: YieldStrategy): number {
  const base = slot.baseRate * slot.demandMultiplier;

  // Adjust for occupancy gap vs target
  const occupancyGap = slot.occupancyRate - strategy.targetOccupancy;
  const occupancyAdjust = occupancyGap * strategy.priceElasticity * slot.baseRate;

  const raw = base + occupancyAdjust;
  return Math.round(Math.max(strategy.minRate, Math.min(strategy.maxRate, raw)) * 100) / 100;
}

function revenueOpportunity(slot: YieldSlot, strategy: YieldStrategy): number {
  const optimal = yieldRate(slot, strategy);
  return Math.round((optimal - slot.baseRate) * 100) / 100;
}

function isUnderperforming(slot: YieldSlot, strategy: YieldStrategy): boolean {
  return slot.occupancyRate < strategy.targetOccupancy * 0.7;
}

function bestYieldSlot(slots: YieldSlot[], strategy: YieldStrategy): YieldSlot | null {
  if (slots.length === 0) return null;
  return slots.reduce((best, s) =>
    yieldRate(s, strategy) > yieldRate(best, strategy) ? s : best, slots[0]
  );
}

function avgYieldRate(slots: YieldSlot[], strategy: YieldStrategy): number {
  if (slots.length === 0) return 0;
  return Math.round(slots.reduce((s, slot) => s + yieldRate(slot, strategy), 0) / slots.length * 100) / 100;
}

const STRATEGY: YieldStrategy = {
  minRate: 50, maxRate: 500, targetOccupancy: 0.75, priceElasticity: 1.2,
};
const SLOTS: YieldSlot[] = [
  { date: "2026-11-01", hour: 9,  baseRate: 150, demandMultiplier: 1.5, occupancyRate: 0.9, competitorRate: 180 },
  { date: "2026-11-01", hour: 14, baseRate: 150, demandMultiplier: 0.8, occupancyRate: 0.3, competitorRate: 120 },
  { date: "2026-11-01", hour: 18, baseRate: 150, demandMultiplier: 2.0, occupancyRate: 1.0, competitorRate: 220 },
];

describe("Yield management", () => {
  it("yieldRate: high demand slot earns more", () => {
    expect(yieldRate(SLOTS[2], STRATEGY)).toBeGreaterThan(yieldRate(SLOTS[1], STRATEGY));
  });

  it("yieldRate: capped at maxRate", () => {
    const highDemand = { ...SLOTS[2], demandMultiplier: 5, occupancyRate: 1.0 };
    expect(yieldRate(highDemand, STRATEGY)).toBeLessThanOrEqual(STRATEGY.maxRate);
  });

  it("isUnderperforming: 30% occupancy vs 75% target → true", () => {
    expect(isUnderperforming(SLOTS[1], STRATEGY)).toBe(true);
  });

  it("isUnderperforming: 90% occupancy → false", () => {
    expect(isUnderperforming(SLOTS[0], STRATEGY)).toBe(false);
  });

  it("bestYieldSlot: highest demand slot", () => {
    expect(bestYieldSlot(SLOTS, STRATEGY)?.hour).toBe(18);
  });

  it("avgYieldRate: positive number", () => {
    expect(avgYieldRate(SLOTS, STRATEGY)).toBeGreaterThan(0);
  });
});
