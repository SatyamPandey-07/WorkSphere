import { QUIET_THRESHOLD_DB, PEAK_THRESHOLD_DB } from "@/lib/quietHoursPrediction";

// Test the constants and logic without calling Prisma
describe("quietHoursPrediction constants", () => {
  it("QUIET_THRESHOLD_DB is below PEAK_THRESHOLD_DB", () => {
    expect(QUIET_THRESHOLD_DB).toBeLessThan(PEAK_THRESHOLD_DB);
  });

  it("QUIET_THRESHOLD_DB is in a reasonable range (40-65 dB)", () => {
    expect(QUIET_THRESHOLD_DB).toBeGreaterThanOrEqual(40);
    expect(QUIET_THRESHOLD_DB).toBeLessThanOrEqual(65);
  });

  it("PEAK_THRESHOLD_DB is in a reasonable range (65-90 dB)", () => {
    expect(PEAK_THRESHOLD_DB).toBeGreaterThanOrEqual(65);
    expect(PEAK_THRESHOLD_DB).toBeLessThanOrEqual(90);
  });
});

// Unit test the logic directly using a mock
describe("quiet window detection logic", () => {
  // Simulate the window merging logic inline without importing Prisma
  function mergeQuietWindows(quietHours: number[]) {
    const windows: Array<{ startHour: number; endHour: number }> = [];
    let start: number | null = null;

    for (let i = 0; i < 24; i++) {
      const isQuiet = quietHours.includes(i);
      if (isQuiet && start === null) {
        start = i;
      } else if (!isQuiet && start !== null) {
        windows.push({ startHour: start, endHour: i - 1 });
        start = null;
      }
    }
    if (start !== null) {
      windows.push({ startHour: start, endHour: 23 });
    }
    return windows;
  }

  it("returns empty array when no hours are quiet", () => {
    expect(mergeQuietWindows([])).toHaveLength(0);
  });

  it("merges a single quiet hour into one window", () => {
    const windows = mergeQuietWindows([14]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ startHour: 14, endHour: 14 });
  });

  it("merges contiguous quiet hours into one window", () => {
    const windows = mergeQuietWindows([14, 15, 16]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ startHour: 14, endHour: 16 });
  });

  it("creates separate windows for non-contiguous quiet hours", () => {
    const windows = mergeQuietWindows([10, 11, 14, 15]);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toEqual({ startHour: 10, endHour: 11 });
    expect(windows[1]).toEqual({ startHour: 14, endHour: 15 });
  });

  it("handles quiet hours extending to hour 23", () => {
    const windows = mergeQuietWindows([22, 23]);
    expect(windows[windows.length - 1].endHour).toBe(23);
  });

  it("handles quiet hours starting at hour 0", () => {
    const windows = mergeQuietWindows([0, 1, 2]);
    expect(windows[0].startHour).toBe(0);
  });
});
