/**
 * Tests for venue smart pricing engine combining multiple signals.
 */

interface PricingSignal {
  name: string;
  value: number;     // 0-1 normalized
  weight: number;    // relative importance
  direction: "increase" | "decrease"; // does high value mean price up or down?
}

interface PricingDecision {
  basePrice: number;
  adjustedPrice: number;
  adjustmentPercent: number;
  signals: PricingSignal[];
  confidence: number; // 0-1
  reasoning: string[];
}

function weightedSignal(signal: PricingSignal): number {
  const adjusted = signal.direction === "increase" ? signal.value : 1 - signal.value;
  return adjusted * signal.weight;
}

function totalSignalScore(signals: PricingSignal[]): number {
  const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
  if (totalWeight === 0) return 0.5;
  const weightedSum = signals.reduce((s, sig) => s + weightedSignal(sig), 0);
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

function priceAdjustmentFactor(signals: PricingSignal[], maxAdjust = 0.5): number {
  const score = totalSignalScore(signals);
  // score 0.5 = no change, higher = increase, lower = decrease
  const adjustment = (score - 0.5) * 2 * maxAdjust;
  return Math.round((1 + adjustment) * 100) / 100;
}

function smartPrice(basePrice: number, signals: PricingSignal[], config = { min: 0.5, max: 2.5 }): number {
  const factor = priceAdjustmentFactor(signals);
  const clamped = Math.max(config.min, Math.min(config.max, factor));
  return Math.round(basePrice * clamped * 100) / 100;
}

function pricingConfidence(signals: PricingSignal[]): number {
  // Confidence based on how many signals have high weight
  const significantSignals = signals.filter((s) => s.weight > 0.2);
  return Math.min(significantSignals.length / 3, 1);
}

const SIGNALS: PricingSignal[] = [
  { name: "demand",        value: 0.9, weight: 0.4, direction: "increase" },
  { name: "competition",   value: 0.3, weight: 0.3, direction: "decrease" }, // low competition = price up
  { name: "availability",  value: 0.2, weight: 0.2, direction: "decrease" }, // low availability = price up
  { name: "lead_time",     value: 0.8, weight: 0.1, direction: "decrease" }, // long lead time = price down
];

describe("Smart pricing engine", () => {
  it("totalSignalScore: high demand weighted sum > 0.5", () => {
    expect(totalSignalScore(SIGNALS)).toBeGreaterThan(0.5);
  });

  it("priceAdjustmentFactor: high demand scenario > 1", () => {
    expect(priceAdjustmentFactor(SIGNALS)).toBeGreaterThan(1);
  });

  it("smartPrice: $200 base with high demand → higher price", () => {
    expect(smartPrice(200, SIGNALS)).toBeGreaterThan(200);
  });

  it("smartPrice: capped at min 50% of base", () => {
    const lowDemandSignals: PricingSignal[] = [
      { name: "demand", value: 0.0, weight: 1.0, direction: "increase" },
    ];
    expect(smartPrice(200, lowDemandSignals)).toBeGreaterThanOrEqual(200 * 0.5);
  });

  it("pricingConfidence: 3 high-weight signals → high confidence", () => {
    expect(pricingConfidence(SIGNALS)).toBeGreaterThan(0.5);
  });

  it("weightedSignal: decrease direction inverts value", () => {
    const sig: PricingSignal = { name: "x", value: 0.2, weight: 1, direction: "decrease" };
    expect(weightedSignal(sig)).toBe(0.8); // 1 - 0.2
  });
});
