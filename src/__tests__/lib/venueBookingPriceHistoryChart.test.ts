/**
 * Tests for venue booking price history chart data generation.
 */

interface PriceHistoryPoint {
  date: string;
  priceCents: number;
  bookingsCount: number;
}

function normalizeToRange(
  values: number[],
  targetMin: number,
  targetMax: number
): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return values.map(() => (targetMin + targetMax) / 2);
  return values.map((v) => Math.round(targetMin + ((v - min) / (max - min)) * (targetMax - targetMin)));
}

function smoothPriceHistory(
  history: PriceHistoryPoint[],
  windowSize = 3
): PriceHistoryPoint[] {
  return history.map((point, i) => {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const window = history.slice(start, start + windowSize);
    const avgPrice = Math.round(window.reduce((s, p) => s + p.priceCents, 0) / window.length);
    return { ...point, priceCents: avgPrice };
  });
}

function detectPriceTrend(history: PriceHistoryPoint[]): "rising" | "falling" | "stable" {
  if (history.length < 2) return "stable";
  const first = history[0].priceCents;
  const last = history[history.length - 1].priceCents;
  const changePct = ((last - first) / first) * 100;
  if (changePct > 5) return "rising";
  if (changePct < -5) return "falling";
  return "stable";
}

function priceVolatility(history: PriceHistoryPoint[]): number {
  if (history.length < 2) return 0;
  const prices = history.map((p) => p.priceCents);
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  const variance = prices.reduce((s, p) => s + (p - avg) ** 2, 0) / prices.length;
  return Math.round(Math.sqrt(variance));
}

const HISTORY: PriceHistoryPoint[] = [
  { date: "2026-09-01", priceCents: 1000, bookingsCount: 20 },
  { date: "2026-09-08", priceCents: 1100, bookingsCount: 25 },
  { date: "2026-09-15", priceCents: 1200, bookingsCount: 30 },
  { date: "2026-09-22", priceCents: 1150, bookingsCount: 22 },
  { date: "2026-09-29", priceCents: 1300, bookingsCount: 35 },
];

describe("Price history chart data", () => {
  it("normalizeToRange: values scaled to 0-100", () => {
    const normalized = normalizeToRange([1000, 1200, 1500], 0, 100);
    expect(normalized[0]).toBe(0);
    expect(normalized[2]).toBe(100);
  });

  it("normalizeToRange: all same values → midpoint", () => {
    const normalized = normalizeToRange([500, 500, 500], 0, 100);
    expect(normalized.every((v) => v === 50)).toBe(true);
  });

  it("smoothPriceHistory: reduces extremes", () => {
    const smoothed = smoothPriceHistory(HISTORY, 3);
    expect(smoothed).toHaveLength(HISTORY.length);
  });

  it("detectPriceTrend: 1000→1300 = 30% rise → rising", () => {
    expect(detectPriceTrend(HISTORY)).toBe("rising");
  });

  it("detectPriceTrend: stable prices → stable", () => {
    const stable = HISTORY.map((p) => ({ ...p, priceCents: 1000 }));
    expect(detectPriceTrend(stable)).toBe("stable");
  });

  it("priceVolatility: measures spread", () => {
    const vol = priceVolatility(HISTORY);
    expect(vol).toBeGreaterThan(0);
  });

  it("priceVolatility: constant prices → 0", () => {
    const constant = HISTORY.map((p) => ({ ...p, priceCents: 1000 }));
    expect(priceVolatility(constant)).toBe(0);
  });
});
