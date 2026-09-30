/**
 * Tests for venue space turnover and preparation time management.
 */

interface SpaceTurnover {
  spaceId: string;
  venueId: string;
  cleaningMinutes: number;
  setupMinutes: number;
  inspectionMinutes: number;
  isExpress: boolean;  // express turnover skips full cleaning
}

function totalTurnoverMinutes(turnover: SpaceTurnover): number {
  if (turnover.isExpress) {
    return Math.round((turnover.cleaningMinutes * 0.5) + turnover.inspectionMinutes);
  }
  return turnover.cleaningMinutes + turnover.setupMinutes + turnover.inspectionMinutes;
}

function bufferRequiredMs(turnover: SpaceTurnover): number {
  return totalTurnoverMinutes(turnover) * 60_000;
}

function canFitBooking(
  prevEndMs: number,
  nextStartMs: number,
  turnover: SpaceTurnover
): boolean {
  return nextStartMs - prevEndMs >= bufferRequiredMs(turnover);
}

function effectiveCapacityHours(
  openMinutes: number,
  avgBookingMinutes: number,
  turnover: SpaceTurnover
): number {
  const cycleMinutes = avgBookingMinutes + totalTurnoverMinutes(turnover);
  if (cycleMinutes === 0) return 0;
  const cycles = Math.floor(openMinutes / cycleMinutes);
  return Math.round((cycles * avgBookingMinutes) / 60 * 10) / 10;
}

const STANDARD_TURNOVER: SpaceTurnover = {
  spaceId: "sp1", venueId: "v1",
  cleaningMinutes: 15, setupMinutes: 5, inspectionMinutes: 5, isExpress: false,
};

const EXPRESS_TURNOVER: SpaceTurnover = {
  ...STANDARD_TURNOVER, isExpress: true,
};

const NOW = 1_700_000_000_000;

describe("Venue space turnover management", () => {
  it("totalTurnoverMinutes: standard = 15+5+5 = 25 min", () => {
    expect(totalTurnoverMinutes(STANDARD_TURNOVER)).toBe(25);
  });

  it("totalTurnoverMinutes: express = 7.5+5 = 12-13 min", () => {
    expect(totalTurnoverMinutes(EXPRESS_TURNOVER)).toBeCloseTo(12.5, 0);
  });

  it("bufferRequiredMs: standard = 25 × 60000 = 1500000", () => {
    expect(bufferRequiredMs(STANDARD_TURNOVER)).toBe(1_500_000);
  });

  it("canFitBooking: 30 min gap with 25 min turnover → true", () => {
    expect(canFitBooking(NOW, NOW + 1_800_000, STANDARD_TURNOVER)).toBe(true);
  });

  it("canFitBooking: 10 min gap with 25 min turnover → false", () => {
    expect(canFitBooking(NOW, NOW + 600_000, STANDARD_TURNOVER)).toBe(false);
  });

  it("effectiveCapacityHours: 480 min open, 60 min bookings, 25 min turnover", () => {
    // 480 / (60+25) = 5.6 cycles → 5 × 60 / 60 = 5h
    const hours = effectiveCapacityHours(480, 60, STANDARD_TURNOVER);
    expect(hours).toBeCloseTo(5, 0);
  });

  it("effectiveCapacityHours: express turnover improves capacity", () => {
    const standard = effectiveCapacityHours(480, 60, STANDARD_TURNOVER);
    const express = effectiveCapacityHours(480, 60, EXPRESS_TURNOVER);
    expect(express).toBeGreaterThan(standard);
  });
});
