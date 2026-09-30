/**
 * Tests for venue price change history tracking.
 */

interface PriceChange {
  changeId: string;
  venueId: string;
  oldPriceCents: number;
  newPriceCents: number;
  changedAt: number;
  changedBy: string;
  reason: string;
}

function priceChangePercent(change: PriceChange): number {
  if (change.oldPriceCents === 0) return 100;
  return Math.round(((change.newPriceCents - change.oldPriceCents) / change.oldPriceCents) * 100);
}

function isPriceIncrease(change: PriceChange): boolean {
  return change.newPriceCents > change.oldPriceCents;
}

function latestPrice(changes: PriceChange[], venueId: string): number | null {
  const venueChanges = changes
    .filter((c) => c.venueId === venueId)
    .sort((a, b) => b.changedAt - a.changedAt);
  return venueChanges.length > 0 ? venueChanges[0].newPriceCents : null;
}

function priceHistory(changes: PriceChange[], venueId: string): PriceChange[] {
  return changes
    .filter((c) => c.venueId === venueId)
    .sort((a, b) => a.changedAt - b.changedAt);
}

function volatilityScore(changes: PriceChange[], venueId: string): number {
  const history = priceHistory(changes, venueId);
  if (history.length < 2) return 0;
  const totalVariance = history.reduce((sum, c) => sum + Math.abs(priceChangePercent(c)), 0);
  return Math.round(totalVariance / history.length);
}

const NOW = 1_700_000_000_000;
const CHANGES: PriceChange[] = [
  { changeId: "c1", venueId: "v1", oldPriceCents: 1000, newPriceCents: 1200, changedAt: NOW - 7200_000, changedBy: "owner", reason: "demand"    },
  { changeId: "c2", venueId: "v1", oldPriceCents: 1200, newPriceCents: 1100, changedAt: NOW - 3600_000, changedBy: "admin",  reason: "competitor" },
  { changeId: "c3", venueId: "v2", oldPriceCents: 800,  newPriceCents: 850,  changedAt: NOW - 1000,     changedBy: "owner",  reason: "inflation"  },
];

describe("Venue price update history", () => {
  it("priceChangePercent: 1000→1200 = +20%", () => {
    expect(priceChangePercent(CHANGES[0])).toBe(20);
  });

  it("priceChangePercent: decrease", () => {
    expect(priceChangePercent(CHANGES[1])).toBe(-8);
  });

  it("isPriceIncrease: 1000→1200 → true", () => {
    expect(isPriceIncrease(CHANGES[0])).toBe(true);
  });

  it("isPriceIncrease: decrease → false", () => {
    expect(isPriceIncrease(CHANGES[1])).toBe(false);
  });

  it("latestPrice: most recent price for v1 = 1100", () => {
    expect(latestPrice(CHANGES, "v1")).toBe(1100);
  });

  it("latestPrice: unknown venue → null", () => {
    expect(latestPrice(CHANGES, "v99")).toBeNull();
  });

  it("priceHistory: v1 sorted chronologically", () => {
    const history = priceHistory(CHANGES, "v1");
    expect(history).toHaveLength(2);
    expect(history[0].changedAt).toBeLessThan(history[1].changedAt);
  });

  it("volatilityScore: v1 with 2 changes", () => {
    expect(volatilityScore(CHANGES, "v1")).toBeGreaterThan(0);
  });
});
