/**
 * Tests for analytics KPI dashboard metric computation.
 */

interface KpiDataPoint {
  date: string;      // YYYY-MM-DD
  value: number;
}

function seriesAverage(data: KpiDataPoint[]): number {
  if (data.length === 0) return 0;
  return data.reduce((sum, d) => sum + d.value, 0) / data.length;
}

function seriesMax(data: KpiDataPoint[]): KpiDataPoint | null {
  if (data.length === 0) return null;
  return data.reduce((max, d) => d.value > max.value ? d : max);
}

function seriesMin(data: KpiDataPoint[]): KpiDataPoint | null {
  if (data.length === 0) return null;
  return data.reduce((min, d) => d.value < min.value ? d : min);
}

function growthRate(first: number, last: number): number {
  if (first === 0) return last > 0 ? 100 : 0;
  return Math.round(((last - first) / first) * 100);
}

function movingAverage(data: KpiDataPoint[], windowSize: number): number[] {
  if (data.length === 0 || windowSize <= 0) return [];
  return data.map((_, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const window = data.slice(start, i + 1);
    return Math.round(window.reduce((s, d) => s + d.value, 0) / window.length);
  });
}

const DATA: KpiDataPoint[] = [
  { date: "2026-10-01", value: 100 },
  { date: "2026-10-02", value: 150 },
  { date: "2026-10-03", value: 120 },
  { date: "2026-10-04", value: 200 },
  { date: "2026-10-05", value: 180 },
];

describe("Analytics KPI dashboard", () => {
  it("seriesAverage: (100+150+120+200+180)/5 = 150", () => {
    expect(seriesAverage(DATA)).toBe(150);
  });

  it("seriesAverage: empty → 0", () => {
    expect(seriesAverage([])).toBe(0);
  });

  it("seriesMax: Oct 4 with 200", () => {
    expect(seriesMax(DATA)!.date).toBe("2026-10-04");
  });

  it("seriesMin: Oct 1 with 100", () => {
    expect(seriesMin(DATA)!.date).toBe("2026-10-01");
  });

  it("growthRate: 100 → 180 = 80%", () => {
    expect(growthRate(100, 180)).toBe(80);
  });

  it("growthRate: from 0 with positives = 100%", () => {
    expect(growthRate(0, 50)).toBe(100);
  });

  it("growthRate: decline", () => {
    expect(growthRate(200, 100)).toBe(-50);
  });

  it("movingAverage: window 3 same length", () => {
    const ma = movingAverage(DATA, 3);
    expect(ma).toHaveLength(DATA.length);
  });

  it("movingAverage: first value = first data point", () => {
    const ma = movingAverage(DATA, 3);
    expect(ma[0]).toBe(100);
  });

  it("movingAverage: empty data → empty", () => {
    expect(movingAverage([], 3)).toHaveLength(0);
  });
});
