import { describe, it, expect, beforeEach } from "@jest/globals";
import { DistributedBloomLimiter, EdgeKVStore } from "../../lib/edge/DistributedBloomLimiter";

class MockKVStore implements EdgeKVStore {
  private store = new Map<string, ArrayBuffer>();

  async get(key: string): Promise<ArrayBuffer | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: ArrayBuffer): Promise<void> {
    this.store.set(key, value.slice(0));
  }
}

describe("DistributedBloomLimiter Edge Fallback (#7928)", () => {
  let limiter: DistributedBloomLimiter;
  let mockKV: MockKVStore;

  beforeEach(() => {
    mockKV = new MockKVStore();
    limiter = new DistributedBloomLimiter({
      sizeBytes: 65536,
      thresholdCount: 5,
      kvStore: mockKV,
    });
  });

  it("rate limits IP requests when threshold is reached", () => {
    const ip = "192.168.1.50";

    for (let i = 0; i < 4; i++) {
      const result = limiter.checkAndIncrement(ip);
      expect(result.limited).toBe(false);
    }

    const fifthReq = limiter.checkAndIncrement(ip);
    expect(fifthReq.limited).toBe(true);
  });

  it("maintains a false positive rate < 1% for distinct IPs", () => {
    const testLimiter = new DistributedBloomLimiter({
      sizeBytes: 65536,
      thresholdCount: 5,
    });

    for (let i = 0; i < 500; i++) {
      const ip = `10.0.${Math.floor(i / 256)}.${i % 256}`;
      for (let j = 0; j < 4; j++) {
        testLimiter.checkAndIncrement(ip);
      }
    }

    let falsePositives = 0;
    const testSamples = 1000;

    for (let i = 0; i < testSamples; i++) {
      const newIp = `172.16.${Math.floor(i / 256)}.${i % 256}`;
      const res = testLimiter.checkAndIncrement(newIp);
      if (res.limited) {
        falsePositives++;
      }
    }

    const fpr = (falsePositives / testSamples) * 100;
    expect(fpr).toBeLessThan(1.0);
  });

  it("synchronizes Counting Bloom Filter state via Edge KV gossip", async () => {
    const node1 = new DistributedBloomLimiter({ thresholdCount: 5, kvStore: mockKV });
    const node2 = new DistributedBloomLimiter({ thresholdCount: 5, kvStore: mockKV });

    const ip = "203.0.113.195";

    for (let i = 0; i < 3; i++) {
      node1.checkAndIncrement(ip);
    }

    await node1.syncGossipState();
    await node2.syncGossipState();

    node2.checkAndIncrement(ip);
    const finalReq = node2.checkAndIncrement(ip);

    expect(finalReq.limited).toBe(true);
  });

  it("decays counters on demand when decayCounters is invoked", () => {
    const ip = "192.168.2.10";
    for (let i = 0; i < 4; i++) {
      limiter.checkAndIncrement(ip);
    }

    expect(limiter.getEstimatedCount(ip)).toBe(4);

    limiter.decayCounters(0.5);
    expect(limiter.getEstimatedCount(ip)).toBe(2);

    limiter.decayCounters(0.5);
    expect(limiter.getEstimatedCount(ip)).toBe(1);
  });

  it("automatically attenuates counters across sliding time windows in checkAndIncrement", () => {
    const windowLimiter = new DistributedBloomLimiter({
      sizeBytes: 1024,
      thresholdCount: 4,
      windowDurationMs: 10_000,
      decayFactor: 0.5,
    });

    const ip = "10.0.0.5";
    const t0 = 100_000;

    // Send 3 requests at t0
    for (let i = 0; i < 3; i++) {
      const r = windowLimiter.checkAndIncrement(ip, t0);
      expect(r.limited).toBe(false);
    }
    expect(windowLimiter.getEstimatedCount(ip)).toBe(3);

    // Advance time by 1 window (10s) -> 3 * 0.5 = 1, increment gives 2
    const resAfterWindow = windowLimiter.checkAndIncrement(ip, t0 + 10_000);
    expect(resAfterWindow.limited).toBe(false);
    expect(resAfterWindow.maxCount).toBe(2);
  });

  it("completely clears counters when reset is called", () => {
    const ip = "192.168.10.99";
    for (let i = 0; i < 5; i++) {
      limiter.checkAndIncrement(ip);
    }
    expect(limiter.getEstimatedCount(ip)).toBe(5);

    limiter.reset();
    expect(limiter.getEstimatedCount(ip)).toBe(0);

    const freshReq = limiter.checkAndIncrement(ip);
    expect(freshReq.limited).toBe(false);
    expect(freshReq.maxCount).toBe(1);
  });
});
