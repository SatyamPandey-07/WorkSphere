import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  DistributedBloomLimiter,
  EdgeKVStore,
} from "../../lib/edge/DistributedBloomLimiter";

class MockKVStore implements EdgeKVStore {
  private store = new Map<string, ArrayBuffer>();

  async get(key: string): Promise<ArrayBuffer | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: ArrayBuffer): Promise<void> {
    this.store.set(key, value.slice(0));
  }
}

class ControlledRegionNetwork {
  private listeners = new Map<string, Set<(state: ArrayBuffer) => void>>();
  private deliveries: Array<{
    atMs: number;
    target: string;
    state: ArrayBuffer;
  }> = [];
  private nowMs = 0;

  subscribe(
    region: string,
    listener: (state: ArrayBuffer) => void,
  ): () => void {
    let listeners = this.listeners.get(region);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(region, listeners);
    }
    listeners.add(listener);
    return () => listeners?.delete(listener);
  }

  publish(
    sourceRegion: string,
    state: ArrayBuffer,
    latenciesMs: Record<string, number>,
  ): void {
    for (const [target, listeners] of this.listeners) {
      if (target === sourceRegion || listeners.size === 0) continue;
      const targetDelay = latenciesMs[target] ?? 0;
      this.deliveries.push({
        atMs: this.nowMs + targetDelay,
        target,
        state: state.slice(0),
      });
    }
  }

  advance(ms: number): void {
    this.nowMs += ms;
    const due = this.deliveries
      .filter((delivery) => delivery.atMs <= this.nowMs)
      .sort((a, b) => a.atMs - b.atMs);
    this.deliveries = this.deliveries.filter(
      (delivery) => delivery.atMs > this.nowMs,
    );
    for (const delivery of due) {
      for (const listener of this.listeners.get(delivery.target) ?? []) {
        listener(delivery.state);
      }
    }
  }

  getPendingCount(): number {
    return this.deliveries.length;
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
      expect(limiter.checkAndIncrement(ip).limited).toBe(false);
    }
    expect(limiter.checkAndIncrement(ip).limited).toBe(true);
  });

  it("maintains a false positive rate < 1% for distinct IPs", () => {
    const testLimiter = new DistributedBloomLimiter({
      sizeBytes: 65536,
      thresholdCount: 5,
    });
    for (let i = 0; i < 500; i++) {
      const ip = `10.0.${Math.floor(i / 256)}.${i % 256}`;
      // Each distinct IP is one inserted element. Repeating the same IP here
      // would model four hits instead of 500 Bloom filter insertions.
      testLimiter.checkAndIncrement(ip);
    }

    let falsePositives = 0;
    const testSamples = 10_000;
    for (let i = 0; i < testSamples; i++) {
      const ip = `172.16.${Math.floor(i / 256)}.${i % 256}`;
      if (testLimiter.checkAndIncrement(ip).limited) falsePositives++;
    }
    expect((falsePositives / testSamples) * 100).toBeLessThan(1.0);
  });

  it("synchronizes Counting Bloom Filter state via Edge KV gossip", async () => {
    const node1 = new DistributedBloomLimiter({
      thresholdCount: 5,
      kvStore: mockKV,
    });
    const node2 = new DistributedBloomLimiter({
      thresholdCount: 5,
      kvStore: mockKV,
    });
    const ip = "203.0.113.195";
    for (let i = 0; i < 3; i++) node1.checkAndIncrement(ip);
    await node1.syncGossipState();
    await node2.syncGossipState();
    node2.checkAndIncrement(ip);
    expect(node2.checkAndIncrement(ip).limited).toBe(true);
  });

  it("decays counters on demand when decayCounters is invoked", () => {
    const ip = "192.168.2.10";
    for (let i = 0; i < 4; i++) limiter.checkAndIncrement(ip);
    expect(limiter.getEstimatedCount(ip)).toBe(4);
    limiter.decayCounters(0.5);
    expect(limiter.getEstimatedCount(ip)).toBe(2);
    limiter.decayCounters(0.5);
    expect(limiter.getEstimatedCount(ip)).toBe(1);
  });

  it("automatically attenuates counters across sliding time windows", () => {
    const windowLimiter = new DistributedBloomLimiter({
      sizeBytes: 1024,
      thresholdCount: 4,
      windowDurationMs: 10_000,
      decayFactor: 0.5,
    });
    const ip = "10.0.0.5";
    const t0 = 100_000;
    for (let i = 0; i < 3; i++) {
      expect(windowLimiter.checkAndIncrement(ip, t0).limited).toBe(false);
    }
    expect(windowLimiter.getEstimatedCount(ip)).toBe(3);
    const res = windowLimiter.checkAndIncrement(ip, t0 + 10_000);
    expect(res.limited).toBe(false);
    expect(res.maxCount).toBe(2);
  });

  it("completely clears counters when reset is called", () => {
    const ip = "192.168.10.99";
    for (let i = 0; i < 5; i++) limiter.checkAndIncrement(ip);
    expect(limiter.getEstimatedCount(ip)).toBe(5);
    limiter.reset();
    expect(limiter.getEstimatedCount(ip)).toBe(0);
    const fresh = limiter.checkAndIncrement(ip);
    expect(fresh.limited).toBe(false);
    expect(fresh.maxCount).toBe(1);
  });

  it("converges concurrent replica updates without duplicate counting", () => {
    const node1 = new DistributedBloomLimiter({
      thresholdCount: 5,
      replicaId: "node-1",
    });
    const node2 = new DistributedBloomLimiter({
      thresholdCount: 5,
      replicaId: "node-2",
    });
    const ip = "198.51.100.10";
    for (let i = 0; i < 2; i++) node1.checkAndIncrement(ip);
    for (let i = 0; i < 2; i++) node2.checkAndIncrement(ip);

    const state1 = node1.exportStateBuffer();
    const state2 = node2.exportStateBuffer();
    node1.importState(new Uint8Array(state2));
    node2.importState(new Uint8Array(state1));
    const duplicate = node2.exportStateBuffer();
    node1.importState(new Uint8Array(duplicate));
    node2.importState(new Uint8Array(duplicate));

    expect(node1.checkAndIncrement(ip).limited).toBe(true);
    expect(node2.checkAndIncrement(ip).limited).toBe(true);
  });

  it("merges out-of-order and duplicate states without regression", () => {
    const node1 = new DistributedBloomLimiter({
      thresholdCount: 5,
      replicaId: "a",
    });
    const node2 = new DistributedBloomLimiter({
      thresholdCount: 5,
      replicaId: "b",
    });
    const ip = "192.0.2.44";
    for (let i = 0; i < 3; i++) node1.checkAndIncrement(ip);
    const stateA = node1.exportStateBuffer();
    for (let i = 0; i < 4; i++) node2.checkAndIncrement(ip);
    const stateB = node2.exportStateBuffer();

    node1.importState(new Uint8Array(stateB));
    node2.importState(new Uint8Array(stateA));
    const resultA = node1.exportState();
    const resultB = node2.exportState();
    expect(Array.from(resultA)).toEqual(Array.from(resultB));
    node1.importState(new Uint8Array(stateB));
    node1.importState(new Uint8Array(stateB));
    expect(Array.from(node1.exportState())).toEqual(Array.from(resultA));
  });

  it("cannot decrease state when a stale snapshot arrives after a newer snapshot", () => {
    const node = new DistributedBloomLimiter({
      thresholdCount: 20,
      replicaId: "node-a",
    });
    const ip = "198.51.100.77";

    for (let i = 0; i < 2; i++) node.checkAndIncrement(ip);
    const stale = node.exportStateBuffer();
    for (let i = 0; i < 3; i++) node.checkAndIncrement(ip);
    const latest = node.exportState();
    node.importState(new Uint8Array(stale));
    node.importState(new Uint8Array(stale));

    expect(Array.from(node.exportState())).toEqual(Array.from(latest));
    expect(
      Array.from(node.exportState()).every(
        (value, index) => value >= latest[index],
      ),
    ).toBe(true);
  });

  it("expires CRDT epochs and restores a low count", () => {
    let now = 1_000_000;
    const limiter = new DistributedBloomLimiter({
      thresholdCount: 3,
      replicaId: "clock-node",
      windowMs: 30_000,
      epochMs: 10_000,
      now: () => now,
    });
    const ip = "203.0.113.7";
    for (let i = 0; i < 3; i++) {
      expect(limiter.checkAndIncrement(ip).limited).toBe(i === 2);
    }
    now += 40_000;
    expect(limiter.checkAndIncrement(ip).limited).toBe(false);
  });

  it("converges three replicas under realistic delayed and reordered delivery", () => {
    jest.useFakeTimers();
    const network = new ControlledRegionNetwork();
    const latenciesMs = {
      "region-a": 20,
      "region-b": 80,
      "region-c": 120,
    };

    const pubSubFor = (region: string) => ({
      publish: (state: ArrayBuffer) =>
        network.publish(region, state, latenciesMs),
      subscribe: (listener: (state: ArrayBuffer) => void) =>
        network.subscribe(region, listener),
    });

    const node1 = new DistributedBloomLimiter({
      thresholdCount: 5,
      replicaId: "region-a",
      pubSub: pubSubFor("region-a"),
      syncIntervalMs: 10,
    });
    const node2 = new DistributedBloomLimiter({
      thresholdCount: 5,
      replicaId: "region-b",
      pubSub: pubSubFor("region-b"),
      syncIntervalMs: 10,
    });
    const node3 = new DistributedBloomLimiter({
      thresholdCount: 5,
      replicaId: "region-c",
      pubSub: pubSubFor("region-c"),
      syncIntervalMs: 10,
    });

    for (const node of [node1, node2, node3]) node.startSync();

    const ip = "203.0.113.20";
    for (let i = 0; i < 3; i++) node1.checkAndIncrement(ip);
    for (let i = 0; i < 2; i++) node2.checkAndIncrement(ip);
    for (let i = 0; i < 1; i++) node3.checkAndIncrement(ip);

    void node1.syncGossipState();
    network.advance(20);
    void node3.syncGossipState();
    network.advance(80);
    void node2.syncGossipState();
    network.advance(120);

    jest.advanceTimersByTime(280);
    network.advance(280);

    const state1 = Array.from(node1.exportState());
    const state2 = Array.from(node2.exportState());
    const state3 = Array.from(node3.exportState());
    expect(state1).toEqual(state2);
    expect(state1).toEqual(state3);
    expect(node1.checkAndIncrement(ip).limited).toBe(true);

    expect(network.getPendingCount()).toBe(0);
    for (const node of [node1, node2, node3]) node.stopSync();
    jest.useRealTimers();
  });

  it("checks three replicas repeatedly without mutating message delivery state", () => {
    const limiter = new DistributedBloomLimiter({
      thresholdCount: 100,
      replicaId: "benchmark-node",
    });
    const ip = "192.0.2.100";
    for (let i = 0; i < 10_000; i++) {
      limiter.checkAndIncrement(`${ip}-${i % 100}`);
    }
    expect(limiter.exportState().length).toBe(65536);
  });
});
