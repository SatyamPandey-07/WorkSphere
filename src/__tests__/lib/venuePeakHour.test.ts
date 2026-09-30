/**
 * Tests for venue peak/off-peak hour detection and pricing multiplier.
 */

interface HourRange {
  startHour: number; // 0-23
  endHour: number;   // 0-23, exclusive
}

const PEAK_RANGES: HourRange[] = [
  { startHour: 8,  endHour: 10 },  // morning rush
  { startHour: 12, endHour: 14 },  // lunch peak
  { startHour: 17, endHour: 20 },  // evening peak
];

function isPeakHour(hour: number, ranges = PEAK_RANGES): boolean {
  return ranges.some((r) => hour >= r.startHour && hour < r.endHour);
}

function peakMultiplier(hour: number, surcharge = 1.5): number {
  return isPeakHour(hour) ? surcharge : 1.0;
}

function peakAdjustedPrice(baseCents: number, hour: number): number {
  return Math.round(baseCents * peakMultiplier(hour));
}

describe("Venue peak hour pricing", () => {
  it("hour 9 is peak (morning rush)", () => {
    expect(isPeakHour(9)).toBe(true);
  });

  it("hour 13 is peak (lunch)", () => {
    expect(isPeakHour(13)).toBe(true);
  });

  it("hour 18 is peak (evening)", () => {
    expect(isPeakHour(18)).toBe(true);
  });

  it("hour 11 is off-peak (between ranges)", () => {
    expect(isPeakHour(11)).toBe(false);
  });

  it("hour 3 is off-peak (early morning)", () => {
    expect(isPeakHour(3)).toBe(false);
  });

  it("boundary: hour 10 is NOT peak (exclusive end)", () => {
    expect(isPeakHour(10)).toBe(false);
  });

  it("boundary: hour 8 IS peak (inclusive start)", () => {
    expect(isPeakHour(8)).toBe(true);
  });

  it("peakMultiplier: peak → 1.5", () => {
    expect(peakMultiplier(9)).toBe(1.5);
  });

  it("peakMultiplier: off-peak → 1.0", () => {
    expect(peakMultiplier(3)).toBe(1.0);
  });

  it("peakAdjustedPrice: 2000 cents at peak = 3000", () => {
    expect(peakAdjustedPrice(2000, 9)).toBe(3000);
  });

  it("peakAdjustedPrice: 2000 cents off-peak = 2000", () => {
    expect(peakAdjustedPrice(2000, 3)).toBe(2000);
  });
});
