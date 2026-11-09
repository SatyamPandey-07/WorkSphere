import {
  calculateMeanAbsoluteJitter,
  calculateRfc3550Jitter,
} from "@/lib/wifi/speedBenchmarkEngine";

describe("calculateMeanAbsoluteJitter", () => {
  it("averages the absolute differences between consecutive samples", () => {
    // differences: 2, 3, 6 -> 11 / 3
    expect(calculateMeanAbsoluteJitter([10, 12, 9, 15])).toBeCloseTo(3.67, 2);
  });

  it("is 0 for perfectly steady latency", () => {
    expect(calculateMeanAbsoluteJitter([20, 20, 20])).toBe(0);
  });

  it("depends on probe order, not just the values", () => {
    expect(calculateMeanAbsoluteJitter([10, 20, 10, 20])).toBe(10);
    expect(calculateMeanAbsoluteJitter([10, 10, 20, 20])).toBeCloseTo(3.33, 2);
  });

  it("returns null with fewer than two valid samples", () => {
    expect(calculateMeanAbsoluteJitter([])).toBeNull();
    expect(calculateMeanAbsoluteJitter([5])).toBeNull();
    expect(calculateMeanAbsoluteJitter([5, NaN])).toBeNull();
    expect(calculateMeanAbsoluteJitter([NaN, Infinity])).toBeNull();
  });

  it("ignores non-finite samples", () => {
    expect(calculateMeanAbsoluteJitter([10, NaN, 14])).toBe(4);
  });

  it("rounds to two decimals", () => {
    // differences: 1, 2, 1 -> 4 / 3
    expect(calculateMeanAbsoluteJitter([0, 1, 3, 4])).toBe(1.33);
  });

  it("reads higher than the RFC 3550 estimate on a short probe run", () => {
    const samples = [10, 20, 10, 20, 10, 20];
    const mean = calculateMeanAbsoluteJitter(samples);
    expect(mean).toBe(10);
    expect(calculateRfc3550Jitter(samples)).toBeLessThan(mean as number);
  });
});
