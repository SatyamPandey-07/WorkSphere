/**
 * Tests for venue capacity forecast based on historical patterns.
 */

interface HourlyPattern {
  hour: number;
  avgOccupancyPct: number;
}

function forecastOccupancy(
  patterns: HourlyPattern[],
  hour: number
): number {
  const p = patterns.find((p) => p.hour === hour);
  return p ? p.avgOccupancyPct : 0;
}

function peakForecastHour(patterns: HourlyPattern[]): number | null {
  if (patterns.length === 0) return null;
  return patterns.reduce((peak, p) =>
    p.avgOccupancyPct > peak.avgOccupancyPct ? p : peak
  ).hour;
}

function lowOccupancyHours(
  patterns: HourlyPattern[],
  threshold: number
): number[] {
  return patterns.filter((p) => p.avgOccupancyPct < threshold).map((p) => p.hour);
}

function smoothForecast(patterns: HourlyPattern[], windowSize = 3): HourlyPattern[] {
  return patterns.map((p, i) => {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(patterns.length, start + windowSize);
    const window = patterns.slice(start, end);
    const avg = window.reduce((s, wp) => s + wp.avgOccupancyPct, 0) / window.length;
    return { hour: p.hour, avgOccupancyPct: Math.round(avg) };
  });
}

const PATTERNS: HourlyPattern[] = [
  { hour: 8,  avgOccupancyPct: 20 },
  { hour: 9,  avgOccupancyPct: 60 },
  { hour: 10, avgOccupancyPct: 80 },
  { hour: 11, avgOccupancyPct: 70 },
  { hour: 12, avgOccupancyPct: 90 },
];

describe("Venue capacity forecast", () => {
  it("forecastOccupancy: known hour returns pct", () => {
    expect(forecastOccupancy(PATTERNS, 10)).toBe(80);
  });

  it("forecastOccupancy: unknown hour → 0", () => {
    expect(forecastOccupancy(PATTERNS, 15)).toBe(0);
  });

  it("peakForecastHour: hour 12 has 90%", () => {
    expect(peakForecastHour(PATTERNS)).toBe(12);
  });

  it("peakForecastHour: empty → null", () => {
    expect(peakForecastHour([])).toBeNull();
  });

  it("lowOccupancyHours: below 50% → [8]", () => {
    expect(lowOccupancyHours(PATTERNS, 50)).toEqual([8]);
  });

  it("lowOccupancyHours: high threshold → all hours", () => {
    expect(lowOccupancyHours(PATTERNS, 100)).toHaveLength(5);
  });

  it("smoothForecast returns same length", () => {
    expect(smoothForecast(PATTERNS)).toHaveLength(PATTERNS.length);
  });

  it("smoothForecast: preserves hour keys", () => {
    const smoothed = smoothForecast(PATTERNS);
    expect(smoothed[0].hour).toBe(8);
  });
});
