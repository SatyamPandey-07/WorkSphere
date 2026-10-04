/**
 * Tests for venue booking predictive demand modeling utilities.
 */

interface DemandObservation {
  periodId: string;
  timestamp: number;
  demand: number;        // actual observed demand (bookings)
  externalFactors: {
    isHoliday: boolean;
    weatherScore: number;   // 0-100
    localEventNearby: boolean;
  };
}

interface DemandForecast {
  periodId: string;
  forecastedDemand: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
}

function simpleMovingAverage(observations: DemandObservation[], windowSize: number): number {
  const recent = observations.slice(-windowSize);
  if (recent.length === 0) return 0;
  return Math.round(recent.reduce((s, o) => s + o.demand, 0) / recent.length * 10) / 10;
}

function weatherAdjustment(weatherScore: number, baseline = 50): number {
  return 1 + ((weatherScore - baseline) / baseline) * 0.2;
}

function holidayMultiplier(isHoliday: boolean, eventNearby: boolean): number {
  let mult = 1;
  if (isHoliday) mult += 0.3;
  if (eventNearby) mult += 0.2;
  return mult;
}

function adjustedForecast(
  baseForecast: number,
  observation: Pick<DemandObservation, "externalFactors">
): number {
  const weather = weatherAdjustment(observation.externalFactors.weatherScore);
  const event = holidayMultiplier(
    observation.externalFactors.isHoliday,
    observation.externalFactors.localEventNearby
  );
  return Math.round(baseForecast * weather * event * 10) / 10;
}

function forecastAccuracy(forecasts: DemandForecast[], actuals: DemandObservation[]): number {
  const matched = forecasts.filter((f) =>
    actuals.some((a) => a.periodId === f.periodId)
  );
  if (matched.length === 0) return 0;
  const mape = matched.reduce((s, f) => {
    const actual = actuals.find((a) => a.periodId === f.periodId)!.demand;
    if (actual === 0) return s;
    return s + Math.abs((actual - f.forecastedDemand) / actual);
  }, 0) / matched.length;
  return Math.round((1 - mape) * 100);
}

const NOW = 1_700_000_000_000;
const OBSERVATIONS: DemandObservation[] = [
  { periodId: "p1", timestamp: NOW - 4 * 86_400_000, demand: 20, externalFactors: { isHoliday: false, weatherScore: 60, localEventNearby: false } },
  { periodId: "p2", timestamp: NOW - 3 * 86_400_000, demand: 25, externalFactors: { isHoliday: false, weatherScore: 70, localEventNearby: true } },
  { periodId: "p3", timestamp: NOW - 2 * 86_400_000, demand: 30, externalFactors: { isHoliday: true,  weatherScore: 80, localEventNearby: false } },
  { periodId: "p4", timestamp: NOW - 1 * 86_400_000, demand: 18, externalFactors: { isHoliday: false, weatherScore: 30, localEventNearby: false } },
];

describe("Predictive demand modeling", () => {
  it("simpleMovingAverage: 3-period window = (25+30+18)/3 = 24.3", () => {
    expect(simpleMovingAverage(OBSERVATIONS, 3)).toBe(24.3);
  });

  it("weatherAdjustment: score 70, baseline 50 = 1.08", () => {
    expect(weatherAdjustment(70)).toBeCloseTo(1.08, 1);
  });

  it("holidayMultiplier: holiday + event = 1.5", () => {
    expect(holidayMultiplier(true, true)).toBe(1.5);
  });

  it("adjustedForecast: holiday + good weather boosts demand", () => {
    const base = 20;
    const boosted = adjustedForecast(base, {
      externalFactors: { isHoliday: true, weatherScore: 80, localEventNearby: true }
    });
    expect(boosted).toBeGreaterThan(base);
  });

  it("forecastAccuracy: returns 0-100 value", () => {
    const forecasts: DemandForecast[] = [
      { periodId: "p1", forecastedDemand: 18, lowerBound: 15, upperBound: 22, confidence: 0.8 },
    ];
    const acc = forecastAccuracy(forecasts, OBSERVATIONS);
    expect(acc).toBeGreaterThanOrEqual(0);
    expect(acc).toBeLessThanOrEqual(100);
  });
});
