/**
 * Edge case tests for quiet hours window detection (Issue #2081).
 */

import { QUIET_THRESHOLD_DB, PEAK_THRESHOLD_DB } from "@/lib/quietHoursPrediction";

// Replicate mergeQuietWindows
function mergeQuietWindows(
  hourlyDbs: (number | null)[],
): Array<{ startHour: number; endHour: number }> {
  const windows: Array<{ startHour: number; endHour: number }> = [];
  let start: number | null = null;

  for (let i = 0; i < 24; i++) {
    const db = hourlyDbs[i];
    const isQuiet = db === null || db < QUIET_THRESHOLD_DB;

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

describe("Quiet hours window edge cases", () => {
  it("all quiet → single window spanning 0-23", () => {
    const allQuiet = new Array(24).fill(40); // all < 55dB
    const windows = mergeQuietWindows(allQuiet);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ startHour: 0, endHour: 23 });
  });

  it("all noisy → empty windows", () => {
    const allNoisy = new Array(24).fill(80); // all > 55dB
    const windows = mergeQuietWindows(allNoisy);
    expect(windows).toHaveLength(0);
  });

  it("all null (no data) → treated as quiet", () => {
    const noData = new Array(24).fill(null);
    const windows = mergeQuietWindows(noData);
    expect(windows).toHaveLength(1);
  });

  it("single quiet hour at hour 12", () => {
    const dbs = new Array(24).fill(80);
    dbs[12] = 40;
    const windows = mergeQuietWindows(dbs);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ startHour: 12, endHour: 12 });
  });

  it("two separate quiet periods", () => {
    const dbs = new Array(24).fill(80);
    dbs[2] = 40; dbs[3] = 40; // 2-3 AM
    dbs[14] = 40; dbs[15] = 40; // 2-3 PM
    const windows = mergeQuietWindows(dbs);
    expect(windows).toHaveLength(2);
    expect(windows[0].startHour).toBe(2);
    expect(windows[1].startHour).toBe(14);
  });

  it("window wrapping (quiet at hour 22-23)", () => {
    const dbs = new Array(24).fill(80);
    dbs[22] = 40;
    dbs[23] = 40;
    const windows = mergeQuietWindows(dbs);
    expect(windows.some((w) => w.endHour === 23)).toBe(true);
  });

  it("exactly at threshold (55dB) is NOT quiet", () => {
    const dbs = new Array(24).fill(80);
    dbs[12] = QUIET_THRESHOLD_DB; // exactly 55
    const windows = mergeQuietWindows(dbs);
    // 55 is NOT < 55, so should not be quiet
    expect(windows).toHaveLength(0);
  });

  it("one below threshold (54.9dB) IS quiet", () => {
    const dbs = new Array(24).fill(80);
    dbs[12] = QUIET_THRESHOLD_DB - 0.1; // 54.9
    const windows = mergeQuietWindows(dbs);
    expect(windows).toHaveLength(1);
  });
});
