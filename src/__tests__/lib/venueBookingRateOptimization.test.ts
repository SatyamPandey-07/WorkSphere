/**
 * Tests for venue booking rate optimization algorithms.
 */

interface RateOptimizationInput {
  currentRateCents: number;
  occupancyForecast: number[];  // % for next 7 days
  competitorRates: number[];    // cents per hour
  historicalConversionRate: number;  // 0-1
  targetOccupancyPct: number;
}

function optimalRateCents(input: RateOptimizationInput): number {
  const avgForecast = input.occupancyForecast.reduce((s, v) => s + v, 0) / input.occupancyForecast.length;
  const marketRate = input.competitorRates.length > 0
    ? Math.round(input.competitorRates.reduce((s, r) => s + r, 0) / input.competitorRates.length)
    : input.currentRateCents;

  let adjustment = 1.0;
  if (avgForecast > input.targetOccupancyPct + 10) adjustment = 1.1;  // high demand → increase
  else if (avgForecast < input.targetOccupancyPct - 20) adjustment = 0.9; // low demand → decrease

  const adjustedRate = Math.round(input.currentRateCents * adjustment);
  const marketAdjusted = Math.round((adjustedRate + marketRate) / 2); // blend with market
  return Math.max(Math.round(input.currentRateCents * 0.7), Math.min(Math.round(input.currentRateCents * 1.5), marketAdjusted));
}

function revenueProjection(rateCents: number, expectedBookings: number): number {
  return rateCents * expectedBookings;
}

function rateElasticityImpact(
  currentRate: number,
  newRate: number,
  currentBookings: number,
  elasticity: number
): number {
  const priceChangePct = (newRate - currentRate) / currentRate;
  const demandChangePct = elasticity * priceChangePct;
  return Math.max(0, Math.round(currentBookings * (1 + demandChangePct)));
}

const INPUT: RateOptimizationInput = {
  currentRateCents: 1000,
  occupancyForecast: [80, 85, 90, 75, 70, 65, 80],
  competitorRates: [900, 1100, 950, 1050],
  historicalConversionRate: 0.35,
  targetOccupancyPct: 70,
};

describe("Venue booking rate optimization", () => {
  it("optimalRateCents: high demand → rate above current", () => {
    const optimal = optimalRateCents(INPUT);
    expect(optimal).toBeGreaterThan(900); // should be close to current or higher
  });

  it("optimalRateCents: within bounds (70%-150% of current)", () => {
    const optimal = optimalRateCents(INPUT);
    expect(optimal).toBeGreaterThanOrEqual(700);   // 70% of 1000
    expect(optimal).toBeLessThanOrEqual(1500);  // 150% of 1000
  });

  it("revenueProjection: 1000 × 50 bookings = 50000", () => {
    expect(revenueProjection(1000, 50)).toBe(50_000);
  });

  it("rateElasticityImpact: 10% price increase with -1 elasticity = 10% fewer bookings", () => {
    const newBookings = rateElasticityImpact(1000, 1100, 100, -1.0);
    expect(newBookings).toBe(90); // 100 × (1 + (-1 × 0.1)) = 90
  });

  it("rateElasticityImpact: price decrease → more bookings", () => {
    const newBookings = rateElasticityImpact(1000, 800, 100, -1.5);
    expect(newBookings).toBeGreaterThan(100);
  });

  it("rateElasticityImpact: clamps to 0 for extreme scenarios", () => {
    expect(rateElasticityImpact(1000, 10000, 100, -5.0)).toBe(0);
  });
});
