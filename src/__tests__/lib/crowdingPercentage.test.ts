/**
 * Unit tests for venue occupancy percentage calculation.
 * Formula: occupancyPercent = (count / capacity) * 100, capped at 100.
 */

function occupancyPercent(count: number, capacity: number): number {
  if (capacity <= 0 || isNaN(count) || isNaN(capacity)) return 0;
  const raw = (count / capacity) * 100;
  return Math.min(100, raw);
}

describe("occupancyPercent", () => {
  it("returns 0% when current count is 0", () => {
    expect(occupancyPercent(0, 100)).toBe(0);
  });

  it("returns 100% when venue is exactly at capacity", () => {
    expect(occupancyPercent(50, 50)).toBe(100);
  });

  it("is capped at 100% when count exceeds capacity", () => {
    expect(occupancyPercent(120, 100)).toBe(100);
    expect(occupancyPercent(200, 100)).toBe(100);
  });

  it("returns correct intermediate percentage", () => {
    expect(occupancyPercent(25, 100)).toBe(25);
    expect(occupancyPercent(1, 4)).toBe(25);
    expect(occupancyPercent(3, 4)).toBe(75);
  });

  it("returns 0% when capacity is 0 (guard against division by zero)", () => {
    expect(occupancyPercent(10, 0)).toBe(0);
  });

  it("returns 0% when capacity is negative", () => {
    expect(occupancyPercent(10, -5)).toBe(0);
  });

  it("returns 0% for NaN inputs", () => {
    expect(occupancyPercent(NaN, 100)).toBe(0);
    expect(occupancyPercent(10, NaN)).toBe(0);
  });

  it("result is always within [0, 100]", () => {
    const cases: [number, number][] = [
      [0, 100],
      [50, 100],
      [100, 100],
      [150, 100],
      [0, 1],
      [1, 1],
    ];
    for (const [count, capacity] of cases) {
      const result = occupancyPercent(count, capacity);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});
