/**
 * Tests for the Solana Escrow Latency Benchmark Protocol (#7773).
 */

import {
  computeBenchmarkStatistics,
  runSyntheticBenchmark,
  type LatencyBenchmarkSample,
} from "../../../scripts/bench-solana-escrow-latency";

describe("Solana Escrow Latency Benchmark Protocol (#7773)", () => {
  it("computes accurate paired statistics for sample observations", () => {
    const samples: LatencyBenchmarkSample[] = [
      {
        signature: "sig1",
        tBroadcast: 1000,
        tWebSocketConfirmed: 1450,
        tHttpConfirmed: 2500,
        deltaMs: 1050,
      },
      {
        signature: "sig2",
        tBroadcast: 2000,
        tWebSocketConfirmed: 2420,
        tHttpConfirmed: 3600,
        deltaMs: 1180,
      },
      {
        signature: "sig3",
        tBroadcast: 3000,
        tWebSocketConfirmed: 3410,
        tHttpConfirmed: 4200,
        deltaMs: 790,
      },
      {
        signature: "sig4",
        tBroadcast: 4000,
        tWebSocketConfirmed: 4500,
        tHttpConfirmed: 5900,
        deltaMs: 1400,
      },
    ];

    const stats = computeBenchmarkStatistics(samples, true);

    expect(stats.sampleCount).toBe(4);
    expect(stats.successfulPairs).toBe(4);
    expect(stats.meanDeltaMs).toBe(1105);
    expect(stats.medianDeltaMs).toBe(1115);
    expect(stats.minDeltaMs).toBe(790);
    expect(stats.maxDeltaMs).toBe(1400);
    expect(stats.webSocketWinRate).toBe(100);
    expect(stats.isSynthetic).toBe(true);
  });

  it("handles empty or failed observations gracefully", () => {
    const samples: LatencyBenchmarkSample[] = [
      {
        signature: "sig_fail",
        tBroadcast: 1000,
        tWebSocketConfirmed: null,
        tHttpConfirmed: null,
        deltaMs: null,
      },
    ];

    const stats = computeBenchmarkStatistics(samples, true);
    expect(stats.successfulPairs).toBe(0);
    expect(stats.meanDeltaMs).toBe(0);
    expect(stats.webSocketWinRate).toBe(0);
  });

  it("runs synthetic benchmark simulation demonstrating WebSocket latency advantages", () => {
    const result = runSyntheticBenchmark(50, 2000);

    expect(result.sampleCount).toBe(50);
    expect(result.successfulPairs).toBe(50);
    // Because polling interval is 2000ms and block time is 400ms, mean delta is expected to be ~800-1400ms
    expect(result.meanDeltaMs).toBeGreaterThan(400);
    expect(result.webSocketWinRate).toBeGreaterThan(90);
    expect(result.isSynthetic).toBe(true);
  });
});
