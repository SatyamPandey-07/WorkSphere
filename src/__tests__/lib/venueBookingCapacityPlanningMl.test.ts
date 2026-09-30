/**
 * Tests for ML-assisted venue capacity planning.
 */

interface CapacityDataPoint {
  date: string;
  dayOfWeek: number;
  weekNumber: number;
  actualBookings: number;
  actualRevenue: number;
  weather: "good" | "bad" | "neutral";
  isHoliday: boolean;
}

function seasonalIndex(data: CapacityDataPoint[], weekNumber: number): number {
  const sameWeek = data.filter((d) => d.weekNumber === weekNumber);
  if (sameWeek.length === 0) return 1.0;
  const weekAvg = sameWeek.reduce((s, d) => s + d.actualBookings, 0) / sameWeek.length;
  const globalAvg = data.reduce((s, d) => s + d.actualBookings, 0) / data.length;
  if (globalAvg === 0) return 1.0;
  return Math.round((weekAvg / globalAvg) * 100) / 100;
}

function weatherImpactFactor(data: CapacityDataPoint[]): Record<string, number> {
  const factors: Record<string, { total: number; count: number }> = {
    good: { total: 0, count: 0 }, bad: { total: 0, count: 0 }, neutral: { total: 0, count: 0 },
  };
  const globalAvg = data.reduce((s, d) => s + d.actualBookings, 0) / Math.max(1, data.length);

  data.forEach((d) => {
    factors[d.weather].total += d.actualBookings;
    factors[d.weather].count++;
  });

  const result: Record<string, number> = {};
  for (const [weather, { total, count }] of Object.entries(factors)) {
    if (count === 0) { result[weather] = 1.0; continue; }
    result[weather] = Math.round((total / count / Math.max(1, globalAvg)) * 100) / 100;
  }
  return result;
}

function forecastBookings(
  baseBookings: number,
  seasonalIdx: number,
  weatherFactor: number,
  isHoliday: boolean
): number {
  const holidayFactor = isHoliday ? 0.6 : 1.0;
  return Math.round(baseBookings * seasonalIdx * weatherFactor * holidayFactor);
}

const DATA: CapacityDataPoint[] = [
  { date: "2026-09-07", dayOfWeek: 1, weekNumber: 37, actualBookings: 50, actualRevenue: 25000, weather: "good",    isHoliday: false },
  { date: "2026-09-14", dayOfWeek: 1, weekNumber: 38, actualBookings: 45, actualRevenue: 22500, weather: "bad",     isHoliday: false },
  { date: "2026-09-21", dayOfWeek: 1, weekNumber: 37, actualBookings: 55, actualRevenue: 27500, weather: "good",    isHoliday: false },
  { date: "2026-09-28", dayOfWeek: 1, weekNumber: 39, actualBookings: 30, actualRevenue: 15000, weather: "neutral", isHoliday: true  },
];

describe("ML-assisted venue capacity planning", () => {
  it("seasonalIndex: week 37 above average", () => {
    const idx = seasonalIndex(DATA, 37);
    expect(idx).toBeGreaterThan(1.0); // week 37 (50+55)/2=52.5 > avg 45
  });

  it("seasonalIndex: week 39 with holiday below average", () => {
    expect(seasonalIndex(DATA, 39)).toBeLessThan(1.0);
  });

  it("seasonalIndex: unknown week → 1.0", () => {
    expect(seasonalIndex(DATA, 99)).toBe(1.0);
  });

  it("weatherImpactFactor: good weather > bad weather factor", () => {
    const factors = weatherImpactFactor(DATA);
    expect(factors.good).toBeGreaterThan(factors.bad);
  });

  it("forecastBookings: holiday reduces forecast", () => {
    const normal = forecastBookings(50, 1.0, 1.0, false);
    const holiday = forecastBookings(50, 1.0, 1.0, true);
    expect(holiday).toBeLessThan(normal);
  });

  it("forecastBookings: good weather increases forecast", () => {
    const factors = weatherImpactFactor(DATA);
    const goodWeather = forecastBookings(50, 1.0, factors.good, false);
    const badWeather = forecastBookings(50, 1.0, factors.bad, false);
    expect(goodWeather).toBeGreaterThan(badWeather);
  });
});
