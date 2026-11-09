describe("Date utilities", () => {
  function startOfDayUtc(ms: number): number {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function addDays(ms: number, days: number): number {
    return ms + days * 86_400_000;
  }
  function daysBetween(a: number, b: number): number {
    return Math.round(Math.abs(b - a) / 86_400_000);
  }
  function isWeekend(ms: number): boolean {
    const dow = new Date(ms).getUTCDay();
    return dow === 0 || dow === 6;
  }
  const MON = 1_762_074_000_000; // 2026-11-02 Monday
  it("startOfDayUtc removes time", () => { expect(new Date(startOfDayUtc(MON)).getUTCHours()).toBe(0); });
  it("addDays adds 7 days", () => { expect(daysBetween(MON, addDays(MON, 7))).toBe(7); });
  it("daysBetween calculates correctly", () => { expect(daysBetween(MON, MON + 3 * 86_400_000)).toBe(3); });
  it("Monday is not weekend", () => { expect(isWeekend(MON)).toBe(false); });
  it("Sunday is weekend", () => { expect(isWeekend(MON - 86_400_000)).toBe(true); });
});
