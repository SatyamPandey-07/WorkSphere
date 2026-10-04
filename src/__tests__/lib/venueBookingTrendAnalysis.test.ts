/**
 * Tests for venue booking trend detection and time-series analysis.
 */

interface DataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

function simpleLinearRegression(points: DataPoint[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.value ?? 0 };
  const xMean = points.reduce((s, p) => s + p.timestamp, 0) / n;
  const yMean = points.reduce((s, p) => s + p.value, 0) / n;
  const ssXX = points.reduce((s, p) => s + (p.timestamp - xMean) ** 2, 0);
  const ssXY = points.reduce((s, p) => s + (p.timestamp - xMean) * (p.value - yMean), 0);
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = yMean - slope * xMean;
  return { slope: Math.round(slope * 1e10) / 1e10, intercept: Math.round(intercept * 100) / 100 };
}

function trendDirection(points: DataPoint[]): "up" | "down" | "flat" {
  const { slope } = simpleLinearRegression(points);
  if (slope > 0.0001) return "up";
  if (slope < -0.0001) return "down";
  return "flat";
}

function percentChange(points: DataPoint[]): number {
  if (points.length < 2) return 0;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (first === 0) return 0;
  return Math.round(((last - first) / first) * 100);
}

function movingAverage(points: DataPoint[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = points.slice(start, i + 1);
    result.push(Math.round(window.reduce((s, p) => s + p.value, 0) / window.length * 100) / 100);
  }
  return result;
}

function volatility(points: DataPoint[]): number {
  if (points.length < 2) return 0;
  const mean = points.reduce((s, p) => s + p.value, 0) / points.length;
  const variance = points.reduce((s, p) => s + (p.value - mean) ** 2, 0) / points.length;
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

const DAY = 86_400_000;
const BASE_TS = 1_700_000_000_000;
const TRENDING_UP: DataPoint[] = [
  { timestamp: BASE_TS,          value: 100 },
  { timestamp: BASE_TS + DAY,    value: 115 },
  { timestamp: BASE_TS + 2*DAY,  value: 130 },
  { timestamp: BASE_TS + 3*DAY,  value: 148 },
  { timestamp: BASE_TS + 4*DAY,  value: 160 },
];

describe("Trend detection and time-series analysis", () => {
  it("trendDirection: increasing values → up", () => {
    expect(trendDirection(TRENDING_UP)).toBe("up");
  });

  it("trendDirection: flat values → flat", () => {
    const flat: DataPoint[] = [{ timestamp: 0, value: 100 }, { timestamp: DAY, value: 100 }];
    expect(trendDirection(flat)).toBe("flat");
  });

  it("percentChange: 100 → 160 = 60%", () => {
    expect(percentChange(TRENDING_UP)).toBe(60);
  });

  it("movingAverage: returns same length as input", () => {
    expect(movingAverage(TRENDING_UP, 3).length).toBe(5);
  });

  it("movingAverage: first element = first value", () => {
    expect(movingAverage(TRENDING_UP, 3)[0]).toBe(100);
  });

  it("volatility: returns non-negative value", () => {
    expect(volatility(TRENDING_UP)).toBeGreaterThan(0);
  });
});
