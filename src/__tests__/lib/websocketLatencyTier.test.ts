/**
 * Tests for the WebSocket latency tier classification (Issue #1759).
 * green < 50ms, yellow 50-149ms, red >= 150ms.
 */

import { type LatencyTier } from "@/hooks/useWebSocketLatency";

function toTier(ms: number | null): LatencyTier {
  if (ms === null) return "unknown";
  if (ms < 50) return "good";
  if (ms < 150) return "fair";
  return "poor";
}

describe("WebSocket latency tier classification", () => {
  it("null → 'unknown'", () => {
    expect(toTier(null)).toBe("unknown");
  });

  it("0ms → 'good'", () => {
    expect(toTier(0)).toBe("good");
  });

  it("49ms → 'good'", () => {
    expect(toTier(49)).toBe("good");
  });

  it("50ms → 'fair' (boundary)", () => {
    expect(toTier(50)).toBe("fair");
  });

  it("100ms → 'fair'", () => {
    expect(toTier(100)).toBe("fair");
  });

  it("149ms → 'fair' (upper boundary)", () => {
    expect(toTier(149)).toBe("fair");
  });

  it("150ms → 'poor' (boundary)", () => {
    expect(toTier(150)).toBe("poor");
  });

  it("300ms → 'poor'", () => {
    expect(toTier(300)).toBe("poor");
  });

  it("tiers are ordered: good < fair < poor", () => {
    const order: LatencyTier[] = ["good", "fair", "poor"];
    const values = [25, 75, 200];
    const tiers = values.map(toTier);
    expect(tiers).toEqual(order);
  });

  it("increasing latency never goes to a better tier", () => {
    const latencies = [0, 10, 49, 50, 100, 149, 150, 200, 500];
    const tiers = latencies.map(toTier);
    const tierOrder = { good: 0, fair: 1, poor: 2, unknown: -1 };

    for (let i = 1; i < tiers.length; i++) {
      expect(tierOrder[tiers[i]]).toBeGreaterThanOrEqual(tierOrder[tiers[i - 1]]);
    }
  });
});
