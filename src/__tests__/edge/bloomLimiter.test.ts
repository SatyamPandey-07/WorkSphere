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

describe("DistributedBloomLimiter Edge Fallback", () => {
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
});
