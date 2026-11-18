import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  DistributedBloomLimiter,
  EdgeKVStore,
} from "../../lib/edge/DistributedBloomLimiter";

class MockKVStore implements EdgeKVStore {
  store = new Map<string, ArrayBuffer>();

  async get(key: string): Promise<ArrayBuffer | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: ArrayBuffer): Promise<void> {
    this.store.set(key, value.slice(0));
  }
}

/** Raises one client's counters to exactly `count` on a small limiter. */
function limiterWithCount(count: number, options = {}) {
  const limiter = new DistributedBloomLimiter({
    sizeBytes: 64,
    thresholdCount: 15,
    ...options,
  });
  for (let i = 0; i < count; i++) limiter.checkAndIncrement("client", 1_000_000);
  return limiter;
}

const nonZeroBytes = (limiter: DistributedBloomLimiter) =>
  Array.from(limiter.exportState()).filter((byte) => byte !== 0).length;

describe("DistributedBloomLimiter counter hardening (#7952)", () => {
  describe("counters stay inside their 4-bit range", () => {
    it("never exceeds 15 under sustained load while decay is delayed", () => {
      const limiter = new DistributedBloomLimiter({
        thresholdCount: 15,
        windowDurationMs: 1_000,
      });
      // Decay never runs: every request carries the same timestamp.
      for (let i = 0; i < 20_000; i++) {
        limiter.checkAndIncrement(`client-${i % 50}`, 5_000_000);
      }

      // Nibbles are 4 bits wide by construction; check no byte holds more than that
      // and that the busiest counter hit the cap rather than going past it.
      let highest = 0;
      for (const byte of limiter.exportState()) {
        highest = Math.max(highest, byte & 0x0f, byte >> 4);
      }
      expect(highest).toBe(15);
      for (let i = 0; i < 50; i++) {
        const estimate = limiter.getEstimatedCount(`client-${i}`);
        expect(Number.isFinite(estimate)).toBe(true);
        expect(estimate).toBeLessThanOrEqual(15);
      }
    });

    it("recovers after a long stall by clearing the filter in one step", () => {
      const limiter = new DistributedBloomLimiter({
        thresholdCount: 10,
        windowDurationMs: 1_000,
      });
      for (let i = 0; i < 100; i++) limiter.checkAndIncrement("client", 5_000_000);
      expect(limiter.checkAndIncrement("client", 5_000_000).limited).toBe(true);

      // The event loop was blocked for an hour, so many windows pass at once.
      const result = limiter.checkAndIncrement("client", 5_000_000 + 3_600_000);
      expect(result).toEqual({ limited: false, maxCount: 1 });
    });

    it("never lets a decay step grow or corrupt any counter", () => {
      for (const factor of [0.1, 0.5, 0.9, 1, 1.5, 3, 1000, Infinity]) {
        const limiter = new DistributedBloomLimiter({ sizeBytes: 256 });
        const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
        limiter.importState(bytes);

        limiter.decayCounters(factor);

        const after = limiter.exportState();
        for (let i = 0; i < 256; i++) {
          expect(after[i] & 0x0f).toBeLessThanOrEqual(bytes[i] & 0x0f);
          expect(after[i] >> 4).toBeLessThanOrEqual(bytes[i] >> 4);
        }
      }
    });
  });

  describe("decayCounters with unusable factors", () => {
    it("clamps a factor above 1 to 1 instead of overflowing into the neighbour", () => {
      const limiter = limiterWithCount(15);
      const before = limiter.exportState();

      limiter.decayCounters(1.5);

      expect(limiter.exportState()).toEqual(before);
      expect(limiter.getEstimatedCount("client")).toBe(15);
    });

    it("treats Infinity as no decay", () => {
      const limiter = limiterWithCount(12);
      limiter.decayCounters(Infinity);
      expect(limiter.getEstimatedCount("client")).toBe(12);
    });

    it("falls back to the configured factor for NaN instead of wiping the filter", () => {
      const limiter = limiterWithCount(8, { decayFactor: 0.5 });
      limiter.decayCounters(NaN);
      expect(limiter.getEstimatedCount("client")).toBe(4);
    });

    it("keeps zero and negative factors as a full reset", () => {
      const zero = limiterWithCount(8);
      zero.decayCounters(0);
      expect(zero.getEstimatedCount("client")).toBe(0);

      const negative = limiterWithCount(8);
      negative.decayCounters(-Infinity);
      expect(negative.getEstimatedCount("client")).toBe(0);
    });
  });

  describe("constructor options", () => {
    const attempts = (options: object, requests = 40) => {
      const limiter = new DistributedBloomLimiter(options);
      let limited = 0;
      for (let i = 0; i < requests; i++) {
        if (limiter.checkAndIncrement("client").limited) limited++;
      }
      return { limiter, limited };
    };

    it("replaces a non-finite or invalid decayFactor", () => {
      for (const decayFactor of [NaN, Infinity, 2, 50]) {
        const limiter = new DistributedBloomLimiter({
          sizeBytes: 64,
          thresholdCount: 15,
          windowDurationMs: 1_000,
          decayFactor,
        });
        for (let i = 0; i < 15; i++) limiter.checkAndIncrement("client", 1_000_000);
        limiter.checkAndIncrement("client", 1_001_000);
        // NaN falls back to 0.5 (15 -> 7, then +1). Larger values mean no decay.
        const expected = Number.isNaN(decayFactor) ? 8 : 15;
        expect(limiter.getEstimatedCount("client")).toBe(expected);
      }
    });

    it("clamps thresholdCount to the 4-bit maximum so it can always trigger", () => {
      const { limited } = attempts({ thresholdCount: 20 });
      // 14 accepted requests, the 15th reaches the cap and every later one is limited
      expect(limited).toBe(40 - 14);
    });

    it("rounds a fractional thresholdCount up, as the comparison always did", () => {
      const { limited } = attempts({ thresholdCount: 2.5 }, 10);
      // threshold 3: two accepted requests
      expect(limited).toBe(8);
    });

    it("uses the default threshold for NaN, Infinity, zero and negative values", () => {
      for (const thresholdCount of [NaN, Infinity, 0, -3]) {
        const { limited } = attempts({ thresholdCount });
        // default threshold 10: nine accepted requests
        expect(limited).toBe(40 - 9);
      }
    });

    it("never silently disables itself with a bad hashFunctionsCount", () => {
      for (const hashFunctionsCount of [-2, 0, NaN, Infinity]) {
        const { limited } = attempts({ hashFunctionsCount, thresholdCount: 5 });
        expect(limited).toBeGreaterThan(0);
      }
    });

    it("treats a fractional sizeBytes like its integer part", () => {
      const run = (sizeBytes: number) => {
        const limiter = new DistributedBloomLimiter({ sizeBytes, thresholdCount: 5 });
        const results: boolean[] = [];
        for (let i = 0; i < 10; i++) {
          results.push(limiter.checkAndIncrement("client").limited);
        }
        return { results, state: limiter.exportState() };
      };

      const fractional = run(10.7);
      const whole = run(10);

      expect(fractional.state.length).toBe(10);
      expect(fractional.results).toEqual(whole.results);
      expect(fractional.state).toEqual(whole.state);
      expect(fractional.results.some(Boolean)).toBe(true);
    });

    it("falls back to the default size instead of throwing", () => {
      for (const sizeBytes of [-5, NaN, Infinity, 0]) {
        const limiter = new DistributedBloomLimiter({ sizeBytes });
        expect(limiter.exportState().length).toBe(65536);
      }
    });

    it("disables automatic decay for a non-finite or negative windowDurationMs", () => {
      for (const windowDurationMs of [NaN, Infinity, -1000, 0]) {
        const limiter = new DistributedBloomLimiter({
          sizeBytes: 64,
          thresholdCount: 15,
          windowDurationMs,
        });
        for (let i = 0; i < 6; i++) limiter.checkAndIncrement("client", 1_000_000);
        limiter.checkAndIncrement("client", 1_000_000 + 10 * 3_600_000);
        expect(limiter.getEstimatedCount("client")).toBe(7);
      }
    });
  });

  describe("timestamps", () => {
    const windowed = () =>
      new DistributedBloomLimiter({
        sizeBytes: 64,
        thresholdCount: 15,
        windowDurationMs: 1_000,
        decayFactor: 0.5,
      });

    it("ignores NaN and Infinity timestamps instead of wiping the filter", () => {
      for (const bad of [NaN, Infinity, -Infinity]) {
        const limiter = windowed();
        for (let i = 0; i < 6; i++) limiter.checkAndIncrement("client", 1_000_000);

        limiter.checkAndIncrement("client", bad);

        expect(limiter.getEstimatedCount("client")).toBe(7);
      }
    });

    it("keeps decaying normally after a bad timestamp", () => {
      const limiter = windowed();
      for (let i = 0; i < 8; i++) limiter.checkAndIncrement("client", 1_000_000);
      limiter.checkAndIncrement("client", Infinity);

      // One whole window after the original time: 9 -> 4, then +1
      const result = limiter.checkAndIncrement("client", 1_001_000);
      expect(result.maxCount).toBe(5);
    });

    it("clamps an absurdly large finite timestamp and recovers", () => {
      const limiter = windowed();
      for (let i = 0; i < 6; i++) limiter.checkAndIncrement("client", 1_000_000);

      const far = limiter.checkAndIncrement("client", 1e300);
      expect(far).toEqual({ limited: false, maxCount: 1 });

      // Time going back to a normal value must not leave the clock stuck in the future
      limiter.checkAndIncrement("client", 2_000_000);
      expect(limiter.getEstimatedCount("client")).toBe(2);
    });

    it("clamps a negative timestamp", () => {
      const limiter = windowed();
      const result = limiter.checkAndIncrement("client", -5_000);
      expect(result).toEqual({ limited: false, maxCount: 1 });
    });

    describe("boundary and out-of-order timestamp regression (#8027)", () => {
      it("handles requests arriving exactly at decay transition boundaries without negative counter underflow", () => {
        const limiter = new DistributedBloomLimiter({
          sizeBytes: 64,
          thresholdCount: 15,
          windowDurationMs: 1_000,
          decayFactor: 0.5,
        });

        const t0 = 100_000;
        // Seed count to 8
        for (let i = 0; i < 8; i++) {
          limiter.checkAndIncrement("client", t0);
        }
        expect(limiter.getEstimatedCount("client")).toBe(8);

        // Immediately before boundary (t0 + 999ms) -> no decay, increments to 9
        const beforeBoundary = limiter.checkAndIncrement("client", t0 + 999);
        expect(beforeBoundary.limited).toBe(false);
        expect(beforeBoundary.maxCount).toBe(9);

        // Exactly at boundary (t0 + 1000ms) -> 1 window passed: floor(9 * 0.5) = 4, increment to 5
        const atBoundary = limiter.checkAndIncrement("client", t0 + 1000);
        expect(atBoundary.limited).toBe(false);
        expect(atBoundary.maxCount).toBe(5);
        expect(atBoundary.maxCount).toBeGreaterThanOrEqual(0);

        // Immediately after boundary (t0 + 1001ms) -> no new window passed, increments to 6
        const afterBoundary = limiter.checkAndIncrement("client", t0 + 1001);
        expect(afterBoundary.limited).toBe(false);
        expect(afterBoundary.maxCount).toBe(6);

        // Repeated requests at the exact same timestamp
        const sameTs1 = limiter.checkAndIncrement("client", t0 + 1001);
        const sameTs2 = limiter.checkAndIncrement("client", t0 + 1001);
        expect(sameTs1.maxCount).toBe(7);
        expect(sameTs2.maxCount).toBe(8);
        expect(Number.isFinite(sameTs2.maxCount)).toBe(true);
      });

      it("handles out-of-order clock ticks without corrupting state or counter underflow", () => {
        const limiter = new DistributedBloomLimiter({
          sizeBytes: 64,
          thresholdCount: 15,
          windowDurationMs: 1_000,
          decayFactor: 0.5,
        });

        const t0 = 200_000;
        for (let i = 0; i < 6; i++) {
          limiter.checkAndIncrement("client", t0);
        }
        expect(limiter.getEstimatedCount("client")).toBe(6);

        // Advance to t0 + 2000 (2 windows elapsed): floor(6 * 0.5 * 0.5) = 1, increment to 2
        const futureReq = limiter.checkAndIncrement("client", t0 + 2000);
        expect(futureReq.maxCount).toBe(2);

        // Out-of-order clock tick: timestamp jumps backward to an earlier timestamp
        // Clock anchor does not move backwards; no double decay is triggered
        const outOfOrderReq = limiter.checkAndIncrement("client", t0 + 1500);
        expect(outOfOrderReq.maxCount).toBe(3);
        expect(outOfOrderReq.maxCount).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(outOfOrderReq.maxCount)).toBe(true);

        // Subsequent forward request at t0 + 2500 is within 1000ms of the forward anchor (t0 + 2000)
        // so no spurious extra decay window is triggered over overlapping [1500, 2000] interval
        const nextReq = limiter.checkAndIncrement("client", t0 + 2500);
        expect(nextReq.maxCount).toBe(4); // 3 + 1 = 4 (no overlapping decay)
        expect(nextReq.maxCount).toBeGreaterThanOrEqual(0);
      });

      it("strictly enforces monotonicity on 2000 -> 1500 -> 2100 sequence without duplicate decay", () => {
        const limiter = new DistributedBloomLimiter({
          sizeBytes: 64,
          thresholdCount: 15,
          windowDurationMs: 1_000,
          decayFactor: 0.5,
        });

        // 1. Seed counter to 8 at timestamp 1000
        for (let i = 0; i < 8; i++) {
          limiter.checkAndIncrement("client-seq", 1000);
        }
        expect(limiter.getEstimatedCount("client-seq")).toBe(8);

        // 2. Process request at timestamp 2000 (1 whole window from 1000)
        // Decay: floor(8 * 0.5) = 4, then increment -> 5
        const res2000 = limiter.checkAndIncrement("client-seq", 2000);
        expect(res2000.maxCount).toBe(5);

        // 3. Out-of-order timestamp at 1500 arrives
        // Must NOT regress decay anchor backwards, must NOT apply negative decay
        const res1500 = limiter.checkAndIncrement("client-seq", 1500);
        expect(res1500.maxCount).toBe(6);
        expect(res1500.maxCount).toBeGreaterThanOrEqual(0);

        // 4. Subsequent request at timestamp 2100 arrives
        // Interval [1500, 2000] was already decayed; from 2000 to 2100 is only 100ms (< 1 window)
        // Must NOT decay again: count increments from 6 to 7
        const res2100 = limiter.checkAndIncrement("client-seq", 2100);
        expect(res2100.maxCount).toBe(7);
        expect(res2100.maxCount).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(res2100.maxCount)).toBe(true);

        // Repeated request at exact same timestamp 2100 does not trigger decay
        const res2100Repeat = limiter.checkAndIncrement("client-seq", 2100);
        expect(res2100Repeat.maxCount).toBe(8);

        // 5. Future request at timestamp 3000 (1 full window from anchor 2000)
        // Decay: floor(8 * 0.5) = 4, then increment -> 5
        const res3000 = limiter.checkAndIncrement("client-seq", 3000);
        expect(res3000.maxCount).toBe(5);
      });

      it("guarantees non-negative and finite counters under jittered concurrent boundary requests", () => {
        const limiter = new DistributedBloomLimiter({
          sizeBytes: 256,
          thresholdCount: 10,
          windowDurationMs: 1_000,
          decayFactor: 0.5,
        });

        const baseTime = 500_000;
        // Fill initial counters
        for (let i = 0; i < 5; i++) {
          limiter.checkAndIncrement("client-concurrent", baseTime);
        }

        // Simulate high concurrency around boundary with jittered timestamps [-50ms, +50ms]
        const jitterDeltas = [0, -10, 15, -20, 20, 1000, 999, 1001, 1000, 998, 1002, 2000, 1999, 2001];
        for (const delta of jitterDeltas) {
          const res = limiter.checkAndIncrement("client-concurrent", baseTime + delta);
          expect(res.maxCount).toBeGreaterThanOrEqual(0);
          expect(res.maxCount).toBeLessThanOrEqual(15);
          expect(Number.isFinite(res.maxCount)).toBe(true);
        }

        // Inspect all internal bytes in the filter
        for (const byte of limiter.exportState()) {
          const low = byte & 0x0f;
          const high = (byte >> 4) & 0x0f;
          expect(low).toBeGreaterThanOrEqual(0);
          expect(low).toBeLessThanOrEqual(15);
          expect(high).toBeGreaterThanOrEqual(0);
          expect(high).toBeLessThanOrEqual(15);
        }

        const estimate = limiter.getEstimatedCount("client-concurrent");
        expect(estimate).toBeGreaterThanOrEqual(0);
        expect(estimate).toBeLessThanOrEqual(15);
        expect(Number.isFinite(estimate)).toBe(true);
      });

      it("maintains strict rate-limiting enforcement without bypassing limits on boundary requests", () => {
        const limiter = new DistributedBloomLimiter({
          sizeBytes: 128,
          thresholdCount: 5,
          windowDurationMs: 1_000,
          decayFactor: 0.5,
        });

        const t0 = 100_000;
        // Reach limit exactly
        for (let i = 0; i < 4; i++) {
          const res = limiter.checkAndIncrement("ip-limit", t0);
          expect(res.limited).toBe(false);
        }
        const fourthReq = limiter.checkAndIncrement("ip-limit", t0);
        expect(fourthReq.limited).toBe(true);
        expect(fourthReq.maxCount).toBe(5);

        // Immediate subsequent request at same timestamp is still limited
        const immediateBlocked = limiter.checkAndIncrement("ip-limit", t0);
        expect(immediateBlocked.limited).toBe(true);
        expect(immediateBlocked.maxCount).toBe(5);

        // Request right before window boundary is still limited
        const boundaryBlocked = limiter.checkAndIncrement("ip-limit", t0 + 999);
        expect(boundaryBlocked.limited).toBe(true);
        expect(boundaryBlocked.maxCount).toBe(5);

        // Exactly at window boundary (1000ms), decays: floor(5 * 0.5) = 2, then +1 = 3, allowed
        const boundaryAllowed = limiter.checkAndIncrement("ip-limit", t0 + 1000);
        expect(boundaryAllowed.limited).toBe(false);
        expect(boundaryAllowed.maxCount).toBe(3);
      });
    });
  });

  describe("gossip state of an unexpected size", () => {
    let warn: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    const populated = (kvStore: EdgeKVStore) => {
      const limiter = new DistributedBloomLimiter({
        sizeBytes: 4096,
        thresholdCount: 15,
        kvStore,
      });
      for (let c = 0; c < 200; c++) {
        for (let i = 0; i < 3; i++) limiter.checkAndIncrement(`client-${c}`);
      }
      return limiter;
    };

    it("does not wipe local counters when the remote state is shorter", async () => {
      const kv = new MockKVStore();
      kv.store.set("dtn_bloom_limiter_state", new ArrayBuffer(8));
      const limiter = populated(kv);
      const before = nonZeroBytes(limiter);
      expect(before).toBeGreaterThan(100);

      await limiter.syncGossipState();

      expect(nonZeroBytes(limiter)).toBe(before);
      expect(limiter.getEstimatedCount("client-7")).toBe(3);
    });

    it("skips the whole cycle for a longer remote state and leaves the store alone", async () => {
      const kv = new MockKVStore();
      const remote = new ArrayBuffer(8192);
      kv.store.set("dtn_bloom_limiter_state", remote);
      const limiter = populated(kv);

      await limiter.syncGossipState();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(kv.store.get("dtn_bloom_limiter_state")).toBe(remote);
      expect(limiter.getEstimatedCount("client-7")).toBe(3);
    });

    it("still merges and publishes a state of the matching size", async () => {
      const kv = new MockKVStore();
      const a = new DistributedBloomLimiter({ sizeBytes: 4096, thresholdCount: 15, kvStore: kv });
      const b = new DistributedBloomLimiter({ sizeBytes: 4096, thresholdCount: 15, kvStore: kv });
      for (let i = 0; i < 5; i++) a.checkAndIncrement("client");

      await a.syncGossipState();
      await b.syncGossipState();

      expect(warn).not.toHaveBeenCalled();
      expect(b.getEstimatedCount("client")).toBe(5);
      expect(kv.store.get("dtn_bloom_limiter_state")!.byteLength).toBe(4096);
    });
  });
});
