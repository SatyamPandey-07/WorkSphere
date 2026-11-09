import { mean, variance, standardDeviation, median } from "@/lib/statistics";

describe("statistics utility (#3965)", () => {
  it("handles empty or invalid inputs gracefully", () => {
    expect(mean([])).toBe(0);
    expect(mean(null as any)).toBe(0);
    expect(variance([])).toBe(0);
    expect(variance(null as any)).toBe(0);
    expect(median([])).toBe(0);
    expect(median(null as any)).toBe(0);
  });

  it("filters out NaN and non-finite values from calculations", () => {
    const input = [10, 20, NaN, 30, Infinity, -Infinity];
    expect(mean(input)).toBe(20);
    expect(median(input)).toBe(20);
  });

  it("computes accurate mean, variance, standard deviation, and median for valid numbers", () => {
    const data = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(data)).toBe(5);
    expect(variance(data)).toBe(4);
    expect(standardDeviation(data)).toBe(2);
    expect(median(data)).toBe(4.5);
  });
});
