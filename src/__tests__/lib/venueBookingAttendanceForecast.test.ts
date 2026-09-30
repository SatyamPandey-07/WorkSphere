/**
 * Tests for venue attendance forecasting models.
 */

interface AttendanceRecord {
  date: string;        // YYYY-MM-DD
  dayOfWeek: number;   // 0 = Sunday
  isHoliday: boolean;
  weatherScore: number; // 0-100 (100 = perfect)
  actualAttendance: number;
}

interface ForecastModel {
  baseAttendance: number;
  weekendMultiplier: number;
  holidayMultiplier: number;
  weatherCoefficient: number; // per weather unit above 50
}

function forecastAttendance(
  model: ForecastModel,
  dayOfWeek: number,
  isHoliday: boolean,
  weatherScore: number
): number {
  let forecast = model.baseAttendance;
  if (dayOfWeek === 0 || dayOfWeek === 6) forecast *= model.weekendMultiplier;
  if (isHoliday) forecast *= model.holidayMultiplier;
  const weatherBoost = (weatherScore - 50) * model.weatherCoefficient;
  return Math.round(forecast + weatherBoost);
}

function forecastError(actual: number, forecast: number): number {
  return Math.abs(actual - forecast);
}

function meanAbsoluteError(records: AttendanceRecord[], model: ForecastModel): number {
  if (records.length === 0) return 0;
  const totalErr = records.reduce((s, r) => {
    const fc = forecastAttendance(model, r.dayOfWeek, r.isHoliday, r.weatherScore);
    return s + forecastError(r.actualAttendance, fc);
  }, 0);
  return Math.round(totalErr / records.length);
}

function bestDayOfWeek(records: AttendanceRecord[]): number {
  const totals = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (const r of records) {
    totals[r.dayOfWeek] += r.actualAttendance;
    counts[r.dayOfWeek]++;
  }
  const avgs = totals.map((t, i) => (counts[i] ? t / counts[i] : 0));
  return avgs.indexOf(Math.max(...avgs));
}

const MODEL: ForecastModel = {
  baseAttendance: 100, weekendMultiplier: 1.5, holidayMultiplier: 1.8, weatherCoefficient: 2,
};

const RECORDS: AttendanceRecord[] = [
  { date: "2026-10-03", dayOfWeek: 6, isHoliday: false, weatherScore: 75, actualAttendance: 160 },
  { date: "2026-10-06", dayOfWeek: 1, isHoliday: false, weatherScore: 40, actualAttendance: 75 },
  { date: "2026-10-07", dayOfWeek: 2, isHoliday: true,  weatherScore: 80, actualAttendance: 210 },
];

describe("Venue attendance forecasting", () => {
  it("forecastAttendance: weekday, no holiday, neutral weather = base", () => {
    expect(forecastAttendance(MODEL, 3, false, 50)).toBe(100);
  });

  it("forecastAttendance: weekend multiplier applied", () => {
    expect(forecastAttendance(MODEL, 6, false, 50)).toBe(150);
  });

  it("forecastAttendance: holiday boosts attendance", () => {
    const base = forecastAttendance(MODEL, 3, false, 50);
    const holiday = forecastAttendance(MODEL, 3, true, 50);
    expect(holiday).toBeGreaterThan(base);
  });

  it("forecastError: absolute difference", () => {
    expect(forecastError(160, 150)).toBe(10);
  });

  it("meanAbsoluteError: returns non-negative number", () => {
    expect(meanAbsoluteError(RECORDS, MODEL)).toBeGreaterThanOrEqual(0);
  });

  it("bestDayOfWeek: returns valid day 0-6", () => {
    const best = bestDayOfWeek(RECORDS);
    expect(best).toBeGreaterThanOrEqual(0);
    expect(best).toBeLessThanOrEqual(6);
  });
});
