/**
 * Tests for simple ML-based occupancy forecasting using linear regression.
 */

interface DataPoint {
  x: number; // time index (e.g. hours from start)
  y: number; // occupancy %
}

function linearRegression(data: DataPoint[]): { slope: number; intercept: number } {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: data[0]?.y ?? 0 };

  const sumX = data.reduce((s, d) => s + d.x, 0);
  const sumY = data.reduce((s, d) => s + d.y, 0);
  const sumXY = data.reduce((s, d) => s + d.x * d.y, 0);
  const sumXX = data.reduce((s, d) => s + d.x * d.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope: Math.round(slope * 100) / 100, intercept: Math.round(intercept * 100) / 100 };
}

function predictOccupancy(
  model: { slope: number; intercept: number },
  x: number
): number {
  const raw = model.slope * x + model.intercept;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function meanAbsoluteError(data: DataPoint[], model: { slope: number; intercept: number }): number {
  if (data.length === 0) return 0;
  const errors = data.map((d) => Math.abs(d.y - predictOccupancy(model, d.x)));
  return Math.round((errors.reduce((s, e) => s + e, 0) / data.length) * 100) / 100;
}

const TRAINING_DATA: DataPoint[] = [
  { x: 0, y: 20 },
  { x: 2, y: 40 },
  { x: 4, y: 60 },
  { x: 6, y: 80 },
  { x: 8, y: 90 },
];

describe("Occupancy forecasting ML", () => {
  it("linearRegression: positive slope for increasing trend", () => {
    const model = linearRegression(TRAINING_DATA);
    expect(model.slope).toBeGreaterThan(0);
  });

  it("linearRegression: single point → slope 0", () => {
    const model = linearRegression([{ x: 0, y: 50 }]);
    expect(model.slope).toBe(0);
    expect(model.intercept).toBe(50);
  });

  it("predictOccupancy: prediction within 0-100 bounds", () => {
    const model = linearRegression(TRAINING_DATA);
    const pred = predictOccupancy(model, 5);
    expect(pred).toBeGreaterThanOrEqual(0);
    expect(pred).toBeLessThanOrEqual(100);
  });

  it("predictOccupancy: very high x clamped at 100", () => {
    const model = linearRegression(TRAINING_DATA);
    expect(predictOccupancy(model, 1000)).toBe(100);
  });

  it("predictOccupancy: very low → clamps at 0", () => {
    const model = { slope: 10, intercept: -500 };
    expect(predictOccupancy(model, 0)).toBe(0);
  });

  it("meanAbsoluteError: small for linear data", () => {
    const model = linearRegression(TRAINING_DATA);
    expect(meanAbsoluteError(TRAINING_DATA, model)).toBeLessThan(10);
  });

  it("meanAbsoluteError: empty data → 0", () => {
    const model = linearRegression(TRAINING_DATA);
    expect(meanAbsoluteError([], model)).toBe(0);
  });
});
