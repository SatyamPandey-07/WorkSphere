/**
 * Tests for venue workspace flexibility scoring.
 */

interface FlexibilityFeatures {
  minBookingHours: number;
  canExtend: boolean;
  canReschedule: boolean;
  freeRescheduleDays: number;    // days before for free reschedule
  allowPartialDay: boolean;      // can book < full day
  allowHalfHourSlots: boolean;
  weekendAvailable: boolean;
  eveningAvailable: boolean;     // after 6pm
}

function flexibilityScore(features: FlexibilityFeatures): number {
  let score = 0;
  if (features.minBookingHours <= 1) score += 20;  // can book by hour
  else if (features.minBookingHours <= 4) score += 10;
  if (features.canExtend) score += 15;
  if (features.canReschedule) score += 20;
  if (features.freeRescheduleDays >= 24) score += 10; // 24h+ free reschedule
  if (features.allowPartialDay) score += 10;
  if (features.allowHalfHourSlots) score += 10;
  if (features.weekendAvailable) score += 5;
  if (features.eveningAvailable) score += 10;
  return Math.min(score, 100);
}

function flexibilityTier(score: number): "rigid" | "standard" | "flexible" | "super_flexible" {
  if (score >= 75) return "super_flexible";
  if (score >= 50) return "flexible";
  if (score >= 25) return "standard";
  return "rigid";
}

function compareFlexibility(a: FlexibilityFeatures, b: FlexibilityFeatures): number {
  return flexibilityScore(a) - flexibilityScore(b);
}

const MAX_FLEX: FlexibilityFeatures = {
  minBookingHours: 0.5, canExtend: true, canReschedule: true,
  freeRescheduleDays: 48, allowPartialDay: true, allowHalfHourSlots: true,
  weekendAvailable: true, eveningAvailable: true,
};

const MIN_FLEX: FlexibilityFeatures = {
  minBookingHours: 8, canExtend: false, canReschedule: false,
  freeRescheduleDays: 0, allowPartialDay: false, allowHalfHourSlots: false,
  weekendAvailable: false, eveningAvailable: false,
};

describe("Venue workspace flexibility scoring", () => {
  it("flexibilityScore: max flexibility → high score", () => {
    expect(flexibilityScore(MAX_FLEX)).toBeGreaterThan(80);
  });

  it("flexibilityScore: min flexibility → 0", () => {
    expect(flexibilityScore(MIN_FLEX)).toBe(0);
  });

  it("flexibilityTier: super_flexible for high score", () => {
    expect(flexibilityTier(flexibilityScore(MAX_FLEX))).toBe("super_flexible");
  });

  it("flexibilityTier: rigid for zero", () => {
    expect(flexibilityTier(0)).toBe("rigid");
  });

  it("compareFlexibility: max > min", () => {
    expect(compareFlexibility(MAX_FLEX, MIN_FLEX)).toBeGreaterThan(0);
  });

  it("flexibilityScore: weekend adds bonus", () => {
    const noWeekend = flexibilityScore({ ...MAX_FLEX, weekendAvailable: false });
    expect(flexibilityScore(MAX_FLEX)).toBeGreaterThan(noWeekend);
  });
});
