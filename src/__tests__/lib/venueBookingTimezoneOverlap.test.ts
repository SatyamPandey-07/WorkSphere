/**
 * Tests for venue booking timezone overlap detection and conversion.
 */

interface TimeRange {
  startMs: number;
  endMs: number;
  timezone: string;
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function overlapDurationMs(a: TimeRange, b: TimeRange): number {
  if (!overlaps(a, b)) return 0;
  return Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
}

function containsRange(outer: TimeRange, inner: TimeRange): boolean {
  return outer.startMs <= inner.startMs && inner.endMs <= outer.endMs;
}

function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].startMs <= last.endMs) {
      merged[merged.length - 1] = {
        ...last,
        endMs: Math.max(last.endMs, sorted[i].endMs),
      };
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

function totalCoveredMs(ranges: TimeRange[]): number {
  return mergeRanges(ranges).reduce((s, r) => s + (r.endMs - r.startMs), 0);
}

function findGaps(ranges: TimeRange[], windowStart: number, windowEnd: number): TimeRange[] {
  const sorted = mergeRanges(ranges).filter((r) => r.endMs > windowStart && r.startMs < windowEnd);
  const gaps: TimeRange[] = [];
  let cursor = windowStart;
  for (const r of sorted) {
    if (r.startMs > cursor) {
      gaps.push({ startMs: cursor, endMs: r.startMs, timezone: "UTC" });
    }
    cursor = Math.max(cursor, r.endMs);
  }
  if (cursor < windowEnd) {
    gaps.push({ startMs: cursor, endMs: windowEnd, timezone: "UTC" });
  }
  return gaps;
}

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

const RANGE_A: TimeRange = { startMs: NOW,          endMs: NOW + 4 * HOUR, timezone: "UTC" };
const RANGE_B: TimeRange = { startMs: NOW + 2 * HOUR, endMs: NOW + 6 * HOUR, timezone: "UTC" };
const RANGE_C: TimeRange = { startMs: NOW + 8 * HOUR, endMs: NOW + 10 * HOUR, timezone: "UTC" };

describe("Timezone overlap detection", () => {
  it("overlaps: A and B overlap → true", () => {
    expect(overlaps(RANGE_A, RANGE_B)).toBe(true);
  });

  it("overlaps: A and C don't overlap → false", () => {
    expect(overlaps(RANGE_A, RANGE_C)).toBe(false);
  });

  it("overlapDurationMs: A∩B = 2 hours", () => {
    expect(overlapDurationMs(RANGE_A, RANGE_B)).toBe(2 * HOUR);
  });

  it("containsRange: A doesn't contain B (B extends beyond A)", () => {
    expect(containsRange(RANGE_A, RANGE_B)).toBe(false);
  });

  it("mergeRanges: A+B merge into 6h range", () => {
    const merged = mergeRanges([RANGE_A, RANGE_B]);
    expect(merged.length).toBe(1);
    expect(merged[0].endMs - merged[0].startMs).toBe(6 * HOUR);
  });

  it("totalCoveredMs: A+B+C = 8h total (6h merged + 2h)", () => {
    expect(totalCoveredMs([RANGE_A, RANGE_B, RANGE_C])).toBe(8 * HOUR);
  });
});
