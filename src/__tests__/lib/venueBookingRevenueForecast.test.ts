/**
 * Tests for venue booking revenue forecast modeling.
 */

interface RevenueScenario {
  label: string;
  bookingsGrowthPct: number;     // expected growth % vs last period
  avgBookingValueGrowthPct: number;
  cancellationRatePct: number;   // expected cancellation %
}

interface BaselinePeriod {
  totalBookings: number;
  avgBookingValueCents: number;
  cancellationRatePct: number;
  netRevenueCents: number;
}

function forecastRevenue(
  baseline: BaselinePeriod,
  scenario: RevenueScenario
): number {
  const projectedBookings = baseline.totalBookings * (1 + scenario.bookingsGrowthPct / 100);
  const projectedAvgValue = baseline.avgBookingValueCents * (1 + scenario.avgBookingValueGrowthPct / 100);
  const completedRate = 1 - scenario.cancellationRatePct / 100;
  return Math.round(projectedBookings * projectedAvgValue * completedRate);
}

function revenueGrowthFromForecast(
  baseline: BaselinePeriod,
  forecasted: number
): number {
  if (baseline.netRevenueCents === 0) return 0;
  return Math.round(((forecasted - baseline.netRevenueCents) / baseline.netRevenueCents) * 100);
}

function bestCaseRevenue(scenarios: { scenario: RevenueScenario; baseline: BaselinePeriod }[]): number {
  if (scenarios.length === 0) return 0;
  return Math.max(...scenarios.map(({ scenario, baseline }) => forecastRevenue(baseline, scenario)));
}

function worstCaseRevenue(scenarios: { scenario: RevenueScenario; baseline: BaselinePeriod }[]): number {
  if (scenarios.length === 0) return 0;
  return Math.min(...scenarios.map(({ scenario, baseline }) => forecastRevenue(baseline, scenario)));
}

const BASELINE: BaselinePeriod = {
  totalBookings: 100, avgBookingValueCents: 5000,
  cancellationRatePct: 10, netRevenueCents: 450_000,
};

const SCENARIOS: { scenario: RevenueScenario; baseline: BaselinePeriod }[] = [
  { scenario: { label: "Optimistic", bookingsGrowthPct: 20, avgBookingValueGrowthPct: 5, cancellationRatePct: 8 }, baseline: BASELINE },
  { scenario: { label: "Base case", bookingsGrowthPct: 5, avgBookingValueGrowthPct: 0, cancellationRatePct: 10 }, baseline: BASELINE },
  { scenario: { label: "Pessimistic", bookingsGrowthPct: -10, avgBookingValueGrowthPct: -5, cancellationRatePct: 15 }, baseline: BASELINE },
];

describe("Venue booking revenue forecast", () => {
  it("forecastRevenue: 5% growth, same value, 10% cancel", () => {
    const forecast = forecastRevenue(BASELINE, SCENARIOS[1].scenario);
    expect(forecast).toBeGreaterThan(BASELINE.netRevenueCents);
  });

  it("forecastRevenue: pessimistic = decline", () => {
    const forecast = forecastRevenue(BASELINE, SCENARIOS[2].scenario);
    expect(forecast).toBeLessThan(BASELINE.netRevenueCents);
  });

  it("revenueGrowthFromForecast: positive growth", () => {
    const forecast = forecastRevenue(BASELINE, SCENARIOS[0].scenario);
    const growth = revenueGrowthFromForecast(BASELINE, forecast);
    expect(growth).toBeGreaterThan(0);
  });

  it("bestCaseRevenue: optimistic scenario gives most", () => {
    const best = bestCaseRevenue(SCENARIOS);
    const base = forecastRevenue(BASELINE, SCENARIOS[1].scenario);
    expect(best).toBeGreaterThan(base);
  });

  it("worstCaseRevenue: pessimistic gives least", () => {
    const worst = worstCaseRevenue(SCENARIOS);
    const optimistic = forecastRevenue(BASELINE, SCENARIOS[0].scenario);
    expect(worst).toBeLessThan(optimistic);
  });
});
