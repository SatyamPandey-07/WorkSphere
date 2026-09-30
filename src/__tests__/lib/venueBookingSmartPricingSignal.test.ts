/**
 * Tests for real-time pricing signal processing.
 */

interface PricingSignal {
  signalId: string;
  venueId: string;
  type: "competitor_price_drop" | "high_demand" | "low_demand" | "event_nearby" | "weather_good";
  magnitude: number;      // 0-1 strength
  confidence: number;     // 0-1 confidence level
  timestamp: number;
  suggestedAction: "increase" | "decrease" | "hold";
  priceChangePct: number;
}

function shouldActOnSignal(signal: PricingSignal, minConfidence = 0.7): boolean {
  return signal.confidence >= minConfidence && signal.magnitude >= 0.3;
}

function aggregatedPriceChange(signals: PricingSignal[], venueId: string): number {
  const active = signals.filter((s) => s.venueId === venueId && shouldActOnSignal(s));
  if (active.length === 0) return 0;

  let weightedChange = 0;
  let totalWeight = 0;
  for (const signal of active) {
    const weight = signal.magnitude * signal.confidence;
    const change = signal.suggestedAction === "increase" ? signal.priceChangePct :
                   signal.suggestedAction === "decrease" ? -signal.priceChangePct : 0;
    weightedChange += change * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(weightedChange / totalWeight) : 0;
}

function dominantSignalType(signals: PricingSignal[], venueId: string): string | null {
  const active = signals.filter((s) => s.venueId === venueId && shouldActOnSignal(s));
  if (active.length === 0) return null;

  const typeCounts: Record<string, number> = {};
  active.forEach((s) => { typeCounts[s.type] = (typeCounts[s.type] ?? 0) + s.magnitude; });
  return Object.entries(typeCounts).reduce((max, e) => Number(e[1]) > Number(max[1]) ? e : max)[0];
}

const NOW = 1_700_000_000_000;
const SIGNALS: PricingSignal[] = [
  { signalId: "sig1", venueId: "v1", type: "high_demand",    magnitude: 0.9, confidence: 0.85, timestamp: NOW, suggestedAction: "increase", priceChangePct: 15 },
  { signalId: "sig2", venueId: "v1", type: "event_nearby",   magnitude: 0.7, confidence: 0.90, timestamp: NOW, suggestedAction: "increase", priceChangePct: 10 },
  { signalId: "sig3", venueId: "v1", type: "low_demand",     magnitude: 0.2, confidence: 0.80, timestamp: NOW, suggestedAction: "decrease", priceChangePct: 5  }, // low magnitude
  { signalId: "sig4", venueId: "v1", type: "weather_good",   magnitude: 0.4, confidence: 0.50, timestamp: NOW, suggestedAction: "increase", priceChangePct: 8  }, // low confidence
];

describe("Smart pricing signal processing", () => {
  it("shouldActOnSignal: high confidence + magnitude → true", () => {
    expect(shouldActOnSignal(SIGNALS[0])).toBe(true);
  });

  it("shouldActOnSignal: low magnitude → false", () => {
    expect(shouldActOnSignal(SIGNALS[2])).toBe(false);
  });

  it("shouldActOnSignal: low confidence → false", () => {
    expect(shouldActOnSignal(SIGNALS[3])).toBe(false);
  });

  it("aggregatedPriceChange: two increase signals = positive", () => {
    const change = aggregatedPriceChange(SIGNALS, "v1");
    expect(change).toBeGreaterThan(0);
  });

  it("dominantSignalType: high_demand or event_nearby (both have high magnitude)", () => {
    const dominant = dominantSignalType(SIGNALS, "v1");
    expect(["high_demand", "event_nearby"]).toContain(dominant);
  });

  it("aggregatedPriceChange: no active signals → 0", () => {
    expect(aggregatedPriceChange(SIGNALS, "v99")).toBe(0);
  });
});
