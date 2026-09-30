/**
 * Tests for ML demand forecast validation metrics.
 */

interface DemandForecast {
  date: string;
  predicted: number;
  actual: number;
  confidence: number; // 0-1
}

function meanAbsoluteError(forecasts: DemandForecast[]): number {
  if (forecasts.length === 0) return 0;
  const mae = forecasts.reduce((s, f) => s + Math.abs(f.predicted - f.actual), 0) / forecasts.length;
  return Math.round(mae * 100) / 100;
}

function meanAbsolutePercentageError(forecasts: DemandForecast[]): number {
  const valid = forecasts.filter((f) => f.actual !== 0);
  if (valid.length === 0) return 0;
  const mape = valid.reduce((s, f) => s + Math.abs((f.predicted - f.actual) / f.actual), 0) / valid.length * 100;
  return Math.round(mape * 10) / 10;
}

function forecastBias(forecasts: DemandForecast[]): number {
  if (forecasts.length === 0) return 0;
  const avgError = forecasts.reduce((s, f) => s + (f.predicted - f.actual), 0) / forecasts.length;
  return Math.round(avgError * 100) / 100;
}

function forecastAccuracyPct(forecasts: DemandForecast[], tolerancePct = 20): number {
  if (forecasts.length === 0) return 0;
  const accurate = forecasts.filter((f) => {
    if (f.actual === 0) return f.predicted === 0;
    return Math.abs((f.predicted - f.actual) / f.actual) * 100 <= tolerancePct;
  });
  return Math.round((accurate.length / forecasts.length) * 100);
}

function weightedForecast(
  forecast: number,
  marketSignal: number,
  forecastWeight = 0.7
): number {
  return Math.round(forecast * forecastWeight + marketSignal * (1 - forecastWeight));
}

const FORECASTS: DemandForecast[] = [
  { date: "2026-10-01", predicted: 100, actual: 95,  confidence: 0.9 },
  { date: "2026-10-02", predicted: 80,  actual: 90,  confidence: 0.8 },
  { date: "2026-10-03", predicted: 120, actual: 110, confidence: 0.85 },
  { date: "2026-10-04", predicted: 50,  actual: 60,  confidence: 0.7 },
];

describe("ML demand forecast validation", () => {
  it("meanAbsoluteError: avg absolute differences", () => {
    const mae = meanAbsoluteError(FORECASTS);
    expect(mae).toBeGreaterThan(0);
    expect(mae).toBeLessThan(20);
  });

  it("meanAbsolutePercentageError: avg % error", () => {
    const mape = meanAbsolutePercentageError(FORECASTS);
    expect(mape).toBeGreaterThan(0);
  });

  it("forecastBias: systematic over/under prediction", () => {
    const bias = forecastBias(FORECASTS);
    // (100-95)+(80-90)+(120-110)+(50-60) = 5-10+10-10 = -5, /4 = -1.25
    expect(bias).toBeCloseTo(-1.25, 1);
  });

  it("forecastAccuracyPct: all within 20% tolerance", () => {
    // All forecasts within ~20% of actual
    const acc = forecastAccuracyPct(FORECASTS, 20);
    expect(acc).toBe(100);
  });

  it("forecastAccuracyPct: tight tolerance = some fail", () => {
    const acc = forecastAccuracyPct(FORECASTS, 5);
    expect(acc).toBeLessThan(100);
  });

  it("weightedForecast: 70% model + 30% signal", () => {
    expect(weightedForecast(100, 80)).toBe(94); // 70+24=94
  });
});
