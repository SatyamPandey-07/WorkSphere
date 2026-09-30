/**
 * Tests for booking intent signals detection for conversion optimization.
 */

type IntentSignal = "search" | "view_detail" | "select_date" | "add_to_cart" | "checkout_start";

interface UserJourney {
  userId: string;
  venueId: string;
  signals: { type: IntentSignal; timestamp: number }[];
  convertedAt: number | null;
}

const SIGNAL_WEIGHTS: Record<IntentSignal, number> = {
  search: 1, view_detail: 3, select_date: 5, add_to_cart: 8, checkout_start: 10,
};

function intentScore(journey: UserJourney): number {
  if (journey.signals.length === 0) return 0;
  const maxPerType: Record<string, number> = {};
  journey.signals.forEach((s) => {
    maxPerType[s.type] = Math.max(maxPerType[s.type] ?? 0, SIGNAL_WEIGHTS[s.type]);
  });
  return Object.values(maxPerType).reduce((sum, v) => sum + v, 0);
}

function conversionLikelihood(journey: UserJourney): "low" | "medium" | "high" {
  const score = intentScore(journey);
  if (score >= 15) return "high";
  if (score >= 8) return "medium";
  return "low";
}

function hasSignal(journey: UserJourney, signal: IntentSignal): boolean {
  return journey.signals.some((s) => s.type === signal);
}

function recentSignals(
  journey: UserJourney,
  windowMs: number,
  nowMs: number
): IntentSignal[] {
  return journey.signals
    .filter((s) => nowMs - s.timestamp <= windowMs)
    .map((s) => s.type);
}

const NOW = 1_700_000_000_000;
const JOURNEY: UserJourney = {
  userId: "u1", venueId: "v1",
  signals: [
    { type: "search",         timestamp: NOW - 3600_000 },
    { type: "view_detail",    timestamp: NOW - 1800_000 },
    { type: "select_date",    timestamp: NOW - 900_000  },
    { type: "add_to_cart",    timestamp: NOW - 300_000  },
  ],
  convertedAt: null,
};

describe("Booking intent detection", () => {
  it("intentScore: search+view+select+cart = 1+3+5+8 = 17", () => {
    expect(intentScore(JOURNEY)).toBe(17);
  });

  it("intentScore: empty signals → 0", () => {
    expect(intentScore({ ...JOURNEY, signals: [] })).toBe(0);
  });

  it("conversionLikelihood: score 17 → high", () => {
    expect(conversionLikelihood(JOURNEY)).toBe("high");
  });

  it("conversionLikelihood: low score → low", () => {
    const low = { ...JOURNEY, signals: [{ type: "search" as IntentSignal, timestamp: NOW }] };
    expect(conversionLikelihood(low)).toBe("low");
  });

  it("hasSignal: add_to_cart → true", () => {
    expect(hasSignal(JOURNEY, "add_to_cart")).toBe(true);
  });

  it("hasSignal: checkout_start → false (not in journey)", () => {
    expect(hasSignal(JOURNEY, "checkout_start")).toBe(false);
  });

  it("recentSignals: last 5 min = add_to_cart", () => {
    const recent = recentSignals(JOURNEY, 5 * 60_000, NOW);
    expect(recent).toContain("add_to_cart");
    expect(recent).not.toContain("search");
  });

  it("intentScore: duplicate signals not double-counted", () => {
    const dup = { ...JOURNEY, signals: [
      ...JOURNEY.signals,
      { type: "add_to_cart" as IntentSignal, timestamp: NOW - 100 },
    ]};
    expect(intentScore(dup)).toBe(17); // add_to_cart counted once (max weight)
  });
});
