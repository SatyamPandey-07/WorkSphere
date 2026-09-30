/**
 * Tests for predictive analytics for venue booking optimization.
 */

interface BookingPrediction {
  date: string;
  dayOfWeek: number;
  predictedBookings: number;
  predictedRevenueCents: number;
  confidenceInterval: [number, number]; // [lower, upper]
  riskLevel: "low" | "medium" | "high";
}

function confidenceWidth(prediction: BookingPrediction): number {
  return prediction.confidenceInterval[1] - prediction.confidenceInterval[0];
}

function isHighConfidence(prediction: BookingPrediction, maxWidth = 20): boolean {
  return confidenceWidth(prediction) <= maxWidth;
}

function expectedRevenueMidpoint(prediction: BookingPrediction): number {
  return prediction.predictedRevenueCents;
}

function weeklyRevenueForecast(predictions: BookingPrediction[]): number {
  return predictions.slice(0, 7).reduce((s, p) => s + p.predictedRevenueCents, 0);
}

function forecastRiskLevel(predictions: BookingPrediction[]): "low" | "medium" | "high" {
  const highRiskCount = predictions.filter((p) => p.riskLevel === "high").length;
  const mediumRiskCount = predictions.filter((p) => p.riskLevel === "medium").length;
  const total = predictions.length;
  if (highRiskCount / total > 0.3) return "high";
  if ((highRiskCount + mediumRiskCount) / total > 0.5) return "medium";
  return "low";
}

function bestDayToOffer(predictions: BookingPrediction[]): string | null {
  if (predictions.length === 0) return null;
  return predictions.reduce((best, p) => p.predictedRevenueCents > best.predictedRevenueCents ? p : best).date;
}

const PREDICTIONS: BookingPrediction[] = [
  { date: "2026-10-06", dayOfWeek: 2, predictedBookings: 15, predictedRevenueCents: 75_000, confidenceInterval: [65_000, 85_000], riskLevel: "low" },
  { date: "2026-10-07", dayOfWeek: 3, predictedBookings: 20, predictedRevenueCents: 100_000,confidenceInterval: [85_000, 115_000],riskLevel: "medium"},
  { date: "2026-10-08", dayOfWeek: 4, predictedBookings: 25, predictedRevenueCents: 125_000,confidenceInterval: [90_000, 160_000],riskLevel: "high" },
];

describe("Predictive analytics for venue bookings", () => {
  it("confidenceWidth: 10000 for first prediction", () => {
    expect(confidenceWidth(PREDICTIONS[0])).toBe(20_000);
  });

  it("isHighConfidence: wide interval → false", () => {
    expect(isHighConfidence(PREDICTIONS[2], 20_000)).toBe(false);
  });

  it("weeklyRevenueForecast: sum of predictions", () => {
    expect(weeklyRevenueForecast(PREDICTIONS)).toBe(300_000);
  });

  it("forecastRiskLevel: 1/3 high risk → high", () => {
    expect(forecastRiskLevel(PREDICTIONS)).toBe("high");
  });

  it("bestDayToOffer: Oct 8 has highest predicted revenue", () => {
    expect(bestDayToOffer(PREDICTIONS)).toBe("2026-10-08");
  });

  it("bestDayToOffer: empty → null", () => {
    expect(bestDayToOffer([])).toBeNull();
  });
});
