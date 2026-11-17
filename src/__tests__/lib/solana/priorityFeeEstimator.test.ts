/**
 * Comprehensive test suite for Dynamic Solana Priority Fee Estimation (#7848).
 *
 * All timers and Solana SDK calls are mocked — no live network interactions.
 */

// Fix jsdom Buffer vs Uint8Array realm mismatch for @noble/hashes
Object.defineProperty(Uint8Array, Symbol.hasInstance, {
  value: (inst: unknown) =>
    (inst != null &&
      typeof inst === "object" &&
      (inst.constructor?.name === "Buffer" ||
        inst.constructor?.name === "Uint8Array" ||
        Buffer.isBuffer(inst))) ||
    false,
  configurable: true,
});

import { Connection, PublicKey } from "@solana/web3.js";
import {
  PriorityFeeEstimator,
  resetPriorityFeeEstimator,
} from "@/lib/solana/priorityFeeEstimator";

describe("PriorityFeeEstimator (#7848)", () => {
  let mockConnection: Partial<Connection>;

  beforeEach(() => {
    resetPriorityFeeEstimator();
    mockConnection = {
      rpcEndpoint: "https://api.devnet.solana.com",
      getRecentPrioritizationFees: jest.fn().mockResolvedValue([]),
    };
  });

  afterEach(() => {
    resetPriorityFeeEstimator();
  });

  // Test 1: Correct 75th-percentile calculation
  it("Test 1: calculates the correct 75th-percentile value from sorted samples", () => {
    const estimator = new PriorityFeeEstimator({ percentile: 75 });
    // 100 samples from 1 to 100
    const samples = Array.from({ length: 100 }, (_, i) => ({ prioritizationFee: (i + 1) * 100 }));
    const result = estimator.calculatePercentile(samples, 75);

    // 75% of 100 is 75th element (index 74) -> 75 * 100 = 7500
    expect(result.value).toBe(7500);
    expect(result.sampleCount).toBe(100);
  });

  // Test 2: Correct handling of unsorted RPC samples
  it("Test 2: sorts unsorted RPC samples properly before percentile calculation", () => {
    const estimator = new PriorityFeeEstimator();
    const unsorted = [
      { prioritizationFee: 50_000 },
      { prioritizationFee: 1_000 },
      { prioritizationFee: 25_000 },
      { prioritizationFee: 10_000 },
    ];
    // Sorted: [1000, 10000, 25000, 50000]. Length = 4. 75% of 4 = index 2 (ceil(3) - 1 = 2) -> 25000
    const result = estimator.calculatePercentile(unsorted, 75);
    expect(result.value).toBe(25_000);
    expect(result.sampleCount).toBe(4);
  });

  // Test 3: Empty RPC response uses safe fallback
  it("Test 3: returns fallback fee when RPC returns empty samples array", async () => {
    (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([]);
    const estimator = new PriorityFeeEstimator({ fallbackMicroLamports: 8_000 });

    const estimate = await estimator.estimatePriorityFee(mockConnection as Connection);
    expect(estimate.microLamports).toBe(8_000);
    expect(estimate.source).toBe("fallback");
    expect(estimate.sampleCount).toBe(0);
  });

  // Test 4: RPC failure uses safe fallback without throwing
  it("Test 4: returns fallback fee gracefully when RPC call throws or times out", async () => {
    (mockConnection.getRecentPrioritizationFees as jest.Mock).mockRejectedValue(
      new Error("503 Service Unavailable"),
    );
    const estimator = new PriorityFeeEstimator({ fallbackMicroLamports: 12_000 });

    const estimate = await estimator.estimatePriorityFee(mockConnection as Connection);
    expect(estimate.microLamports).toBe(12_000);
    expect(estimate.source).toBe("fallback");
  });

  // Test 5: Invalid samples (NaN, negative, non-finite, null) are filtered out
  it("Test 5: filters out invalid, negative, NaN, and null samples", () => {
    const estimator = new PriorityFeeEstimator();
    const invalidSamples = [
      { prioritizationFee: -100 },
      { prioritizationFee: NaN },
      { prioritizationFee: Infinity },
      null as any,
      undefined as any,
      { prioritizationFee: 5_000 },
      { prioritizationFee: 15_000 },
    ];
    const result = estimator.calculatePercentile(invalidSamples, 50);
    // Valid samples: [5000, 15000]. 50% rank index = 0 -> 5000
    expect(result.sampleCount).toBe(2);
    expect(result.value).toBe(5_000);
  });

  // Test 6: Minimum fee bound is strictly enforced
  it("Test 6: enforces configured minimum fee bound", async () => {
    (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
      { prioritizationFee: 10 },
      { prioritizationFee: 20 },
    ]);
    const estimator = new PriorityFeeEstimator({
      minMicroLamports: 2_500,
    });

    const estimate = await estimator.estimatePriorityFee(mockConnection as Connection);
    expect(estimate.microLamports).toBe(2_500);
    expect(estimate.source).toBe("rpc");
  });

  // Test 7: Maximum fee bound is strictly enforced
  it("Test 7: enforces configured maximum fee bound", async () => {
    (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
      { prioritizationFee: 5_000_000 },
      { prioritizationFee: 10_000_000 },
    ]);
    const estimator = new PriorityFeeEstimator({
      maxMicroLamports: 500_000,
    });

    const estimate = await estimator.estimatePriorityFee(mockConnection as Connection);
    expect(estimate.microLamports).toBe(500_000);
    expect(estimate.source).toBe("rpc");
  });

  // Test 8: Cache returns valid cached estimates on subsequent calls
  it("Test 8: caches estimate and serves subsequent calls from cache within TTL", async () => {
    (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
      { prioritizationFee: 10_000 },
    ]);
    const estimator = new PriorityFeeEstimator({ cacheDurationMs: 5_000 });

    const estimate1 = await estimator.estimatePriorityFee(mockConnection as Connection);
    expect(estimate1.source).toBe("rpc");
    expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(1);

    const estimate2 = await estimator.estimatePriorityFee(mockConnection as Connection);
    expect(estimate2.source).toBe("cache");
    expect(estimate2.microLamports).toBe(estimate1.microLamports);
    // Still called only once
    expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(1);
  });

  // Test 9: Expired cache triggers a fresh RPC query
  it("Test 9: triggers a fresh RPC query after cache TTL expires", async () => {
    jest.useFakeTimers();
    (mockConnection.getRecentPrioritizationFees as jest.Mock)
      .mockResolvedValueOnce([{ prioritizationFee: 10_000 }])
      .mockResolvedValueOnce([{ prioritizationFee: 20_000 }]);

    const estimator = new PriorityFeeEstimator({ cacheDurationMs: 2_000 });

    const estimate1 = await estimator.estimatePriorityFee(mockConnection as Connection);
    expect(estimate1.microLamports).toBe(10_000);
    expect(estimate1.source).toBe("rpc");

    // Advance time past TTL
    jest.advanceTimersByTime(2_500);

    const estimate2 = await estimator.estimatePriorityFee(mockConnection as Connection);
    expect(estimate2.microLamports).toBe(20_000);
    expect(estimate2.source).toBe("rpc");
    expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  // Test 10: Concurrent requests do not create duplicate RPC queries
  it("Test 10: coalesces concurrent requests to a single in-flight RPC query", async () => {
    let resolveRpc: (val: any) => void;
    const rpcPromise = new Promise((resolve) => {
      resolveRpc = resolve;
    });
    (mockConnection.getRecentPrioritizationFees as jest.Mock).mockReturnValue(rpcPromise);

    const estimator = new PriorityFeeEstimator();

    const p1 = estimator.estimatePriorityFee(mockConnection as Connection);
    const p2 = estimator.estimatePriorityFee(mockConnection as Connection);
    const p3 = estimator.estimatePriorityFee(mockConnection as Connection);

    resolveRpc!([{ prioritizationFee: 15_000 }]);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(1);
    expect(r1.microLamports).toBe(15_000);
    expect(r2.microLamports).toBe(15_000);
    expect(r3.microLamports).toBe(15_000);
  });

  // Test 11: Account-specific locked writable account queries
  it("Test 11: passes account public keys to RPC query for specific writable accounts", async () => {
    const pubkey = new PublicKey("11111111111111111111111111111111");
    (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
      { prioritizationFee: 30_000 },
    ]);
    const estimator = new PriorityFeeEstimator();

    await estimator.estimatePriorityFee(mockConnection as Connection, [pubkey]);
    expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledWith({
      lockedWritableAccounts: [pubkey],
    });
  });
});
