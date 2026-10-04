describe("Number utilities for booking calculations", () => {
  function roundTo(n: number, decimals: number): number {
    return Math.round(n * 10**decimals) / 10**decimals;
  }
  function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }
  function percentOf(part: number, total: number): number {
    return total === 0 ? 0 : roundTo((part / total) * 100, 2);
  }
  function interpolate(a: number, b: number, t: number): number {
    return roundTo(a + (b - a) * t, 4);
  }
  it("roundTo 2 decimals", () => { expect(roundTo(1.2345, 2)).toBe(1.23); });
  it("clamp below min", () => { expect(clamp(-5, 0, 100)).toBe(0); });
  it("clamp above max", () => { expect(clamp(200, 0, 100)).toBe(100); });
  it("percentOf 30/200 = 15%", () => { expect(percentOf(30, 200)).toBe(15); });
  it("percentOf zero total = 0", () => { expect(percentOf(5, 0)).toBe(0); });
  it("interpolate midpoint", () => { expect(interpolate(0, 100, 0.5)).toBe(50); });
});
