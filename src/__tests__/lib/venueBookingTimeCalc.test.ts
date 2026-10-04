describe("Time calculations for venue bookings", () => {
  function minutesToMs(m: number): number { return m * 60_000; }
  function hoursToMs(h: number): number { return h * 3_600_000; }
  function msToHours(ms: number): number { return Math.round(ms / 3_600_000 * 100) / 100; }
  function formatDuration(ms: number): string {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }
  function isWithinWorkHours(hourUtc: number): boolean { return hourUtc >= 8 && hourUtc < 18; }
  it("minutesToMs converts", () => { expect(minutesToMs(90)).toBe(5_400_000); });
  it("hoursToMs converts", () => { expect(hoursToMs(2)).toBe(7_200_000); });
  it("msToHours rounds", () => { expect(msToHours(5_400_000)).toBe(1.5); });
  it("formatDuration 1.5h", () => { expect(formatDuration(5_400_000)).toBe("1h 30m"); });
  it("9am is work hours", () => { expect(isWithinWorkHours(9)).toBe(true); });
  it("20h not work hours", () => { expect(isWithinWorkHours(20)).toBe(false); });
});
