/**
 * Tests for booking lead time optimization recommendations.
 */

interface BookingLeadTimeData {
  daysInAdvance: number;
  bookingCount: number;
  avgRevenueCents: number;
  cancellationRate: number; // 0-1
}

function weightedConversionScore(data: BookingLeadTimeData): number {
  const revenueScore = data.avgRevenueCents / 10_000; // normalize
  const reliabilityScore = 1 - data.cancellationRate;
  const volumeScore = Math.min(data.bookingCount / 20, 1);
  return Math.round((revenueScore * 0.4 + reliabilityScore * 0.4 + volumeScore * 0.2) * 100) / 100;
}

function optimalLeadTimeRange(
  data: BookingLeadTimeData[],
  minScore = 0.5
): { minDays: number; maxDays: number } | null {
  const eligible = data
    .filter((d) => weightedConversionScore(d) >= minScore)
    .sort((a, b) => a.daysInAdvance - b.daysInAdvance);

  if (eligible.length === 0) return null;
  return {
    minDays: eligible[0].daysInAdvance,
    maxDays: eligible[eligible.length - 1].daysInAdvance,
  };
}

function earlyBirdThreshold(data: BookingLeadTimeData[]): number | null {
  if (data.length === 0) return null;
  const bestData = data.reduce((best, d) =>
    weightedConversionScore(d) > weightedConversionScore(best) ? d : best
  );
  return bestData.daysInAdvance;
}

const DATA: BookingLeadTimeData[] = [
  { daysInAdvance: 1,  bookingCount: 30, avgRevenueCents: 5000,  cancellationRate: 0.3 },
  { daysInAdvance: 3,  bookingCount: 25, avgRevenueCents: 6000,  cancellationRate: 0.15 },
  { daysInAdvance: 7,  bookingCount: 20, avgRevenueCents: 8000,  cancellationRate: 0.05 },
  { daysInAdvance: 14, bookingCount: 15, avgRevenueCents: 9000,  cancellationRate: 0.03 },
  { daysInAdvance: 30, bookingCount: 5,  avgRevenueCents: 10000, cancellationRate: 0.01 },
];

describe("Booking lead time optimizer", () => {
  it("weightedConversionScore: higher revenue + lower cancellation → higher score", () => {
    expect(weightedConversionScore(DATA[4])).toBeGreaterThan(weightedConversionScore(DATA[0]));
  });

  it("optimalLeadTimeRange: returns range of high-scoring lead times", () => {
    const range = optimalLeadTimeRange(DATA);
    expect(range).not.toBeNull();
    expect(range!.minDays).toBeLessThanOrEqual(range!.maxDays);
  });

  it("optimalLeadTimeRange: no data above threshold → null", () => {
    expect(optimalLeadTimeRange(DATA, 2.0)).toBeNull(); // impossible threshold
  });

  it("earlyBirdThreshold: 30-day advance has highest score", () => {
    expect(earlyBirdThreshold(DATA)).toBe(30);
  });

  it("earlyBirdThreshold: empty data → null", () => {
    expect(earlyBirdThreshold([])).toBeNull();
  });
});
