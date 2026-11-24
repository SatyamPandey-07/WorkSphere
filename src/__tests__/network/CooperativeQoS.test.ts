import {
  CooperativeQoSEngine,
  QoSPolicy,
  TokenBucket,
  BPS_TO_BYTES_PER_MS,
  BITS_PER_BYTE,
  MS_PER_SECOND,
} from "@/core/network/CooperativeQoSEngine";
import { PacketTimingAnalyzer } from "@/core/network/PacketTimingAnalyzer";
import {
  analyzer,
  handleWorkerMessage,
  qosEngine,
} from "@/workers/qosMeshWorker";

describe("Cooperative QoS Peer State Cleanup & Active Accounting (#10077)", () => {
  const defaultPolicy: QoSPolicy = {
    maxBandwidthBps: 50_000_000, // 50 Mbps
    voipReserveBps: 5_000_000, // 5 Mbps
    fairShareFactor: 0.8,
  };

  describe("PacketTimingAnalyzer peer removal and metrics cleanup", () => {
    let analyzerInstance: PacketTimingAnalyzer;

    beforeEach(() => {
      analyzerInstance = new PacketTimingAnalyzer();
    });

    it("removes departed peers and excludes them from getMetrics()", () => {
      analyzerInstance.registerPeer("peer-1");
      analyzerInstance.registerPeer("peer-2");

      expect(analyzerInstance.hasPeer("peer-1")).toBe(true);
      expect(analyzerInstance.hasPeer("peer-2")).toBe(true);
      expect(analyzerInstance.getMetrics()).toHaveLength(2);

      analyzerInstance.removePeer("peer-1");

      expect(analyzerInstance.hasPeer("peer-1")).toBe(false);
      expect(analyzerInstance.hasPeer("peer-2")).toBe(true);

      const metrics = analyzerInstance.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].peerId).toBe("peer-2");
    });

    it("ignores telemetry updates for unregister / departed peers", () => {
      analyzerInstance.registerPeer("peer-1");
      analyzerInstance.recordRTT("peer-1", 45);
      analyzerInstance.recordACKDelay("peer-1", 12);
      analyzerInstance.updateBandwidth("peer-1", 250_000);

      // Now remove peer-1
      analyzerInstance.removePeer("peer-1");

      // Attempt late telemetry updates
      analyzerInstance.recordRTT("peer-1", 120);
      analyzerInstance.recordACKDelay("peer-1", 80);
      analyzerInstance.updateBandwidth("peer-1", 500_000);

      // Re-register peer-1 fresh
      analyzerInstance.registerPeer("peer-1");
      const freshMetrics = analyzerInstance
        .getMetrics()
        .find((m) => m.peerId === "peer-1");

      expect(freshMetrics).toBeDefined();
      expect(freshMetrics?.rttHistory).toEqual([]);
      expect(freshMetrics?.ackDelayHistory).toEqual([]);
      expect(freshMetrics?.bytesSentPerSec).toBe(0);
    });

    it("prevents departed peers from influencing bandwidth hog detection", () => {
      analyzerInstance.registerPeer("peer-1");
      analyzerInstance.registerPeer("peer-2");
      analyzerInstance.registerPeer("departed-hog");

      // Populate ACK delay histories with low jitter for normal peers, high for hog
      for (let i = 0; i < 10; i++) {
        analyzerInstance.recordACKDelay("peer-1", 10);
        analyzerInstance.recordACKDelay("peer-2", 10);
        analyzerInstance.recordACKDelay("departed-hog", i % 2 === 0 ? 10 : 200); // Massive variance
      }
      analyzerInstance.updateBandwidth("peer-1", 50_000);
      analyzerInstance.updateBandwidth("peer-2", 50_000);
      analyzerInstance.updateBandwidth("departed-hog", 2_000_000);

      // Before removal, departed-hog is identified as hog
      expect(analyzerInstance.identifyHog()).toBe("departed-hog");

      // Remove the hog peer when it disconnects
      analyzerInstance.removePeer("departed-hog");

      // Now hog detection should not return the departed peer
      expect(analyzerInstance.identifyHog()).toBeNull();
    });
  });

  describe("PacketTimingAnalyzer Telemetry Validation and Variance Integrity (#10088)", () => {
    let analyzerInstance: PacketTimingAnalyzer;

    beforeEach(() => {
      analyzerInstance = new PacketTimingAnalyzer();
      analyzerInstance.registerPeer("peer-1");
      analyzerInstance.registerPeer("peer-2");
    });

    it("validates measurement values with isValidMeasurement helper", () => {
      expect(analyzerInstance.isValidMeasurement(0)).toBe(true);
      expect(analyzerInstance.isValidMeasurement(100.5)).toBe(true);
      expect(analyzerInstance.isValidMeasurement(-1)).toBe(false);
      expect(analyzerInstance.isValidMeasurement(-0.001)).toBe(false);
      expect(analyzerInstance.isValidMeasurement(NaN)).toBe(false);
      expect(analyzerInstance.isValidMeasurement(Infinity)).toBe(false);
      expect(analyzerInstance.isValidMeasurement(-Infinity)).toBe(false);
      expect(analyzerInstance.isValidMeasurement("100" as any)).toBe(false);
      expect(analyzerInstance.isValidMeasurement(null as any)).toBe(false);
      expect(analyzerInstance.isValidMeasurement(undefined as any)).toBe(false);
    });

    it("rejects negative, NaN, and infinite RTT samples without modifying history", () => {
      analyzerInstance.recordRTT("peer-1", 50);
      analyzerInstance.recordRTT("peer-1", 60);

      // Attempt invalid submissions
      analyzerInstance.recordRTT("peer-1", -10);
      analyzerInstance.recordRTT("peer-1", -1);
      analyzerInstance.recordRTT("peer-1", NaN);
      analyzerInstance.recordRTT("peer-1", Infinity);
      analyzerInstance.recordRTT("peer-1", -Infinity);

      const metrics = analyzerInstance
        .getMetrics()
        .find((m) => m.peerId === "peer-1");
      expect(metrics?.rttHistory).toEqual([50, 60]);
    });

    it("rejects negative, NaN, and infinite ACK delay samples without poisoning history", () => {
      analyzerInstance.recordACKDelay("peer-1", 15);
      analyzerInstance.recordACKDelay("peer-1", 20);

      // Attempt invalid submissions
      analyzerInstance.recordACKDelay("peer-1", -5);
      analyzerInstance.recordACKDelay("peer-1", NaN);
      analyzerInstance.recordACKDelay("peer-1", Infinity);
      analyzerInstance.recordACKDelay("peer-1", -Infinity);

      const metrics = analyzerInstance
        .getMetrics()
        .find((m) => m.peerId === "peer-1");
      expect(metrics?.ackDelayHistory).toEqual([15, 20]);
    });

    it("rejects negative, NaN, and infinite bandwidth updates", () => {
      analyzerInstance.updateBandwidth("peer-1", 250_000);
      expect(
        analyzerInstance.getMetrics().find((m) => m.peerId === "peer-1")
          ?.bytesSentPerSec,
      ).toBe(250_000);

      // Attempt invalid submissions
      analyzerInstance.updateBandwidth("peer-1", -100);
      expect(
        analyzerInstance.getMetrics().find((m) => m.peerId === "peer-1")
          ?.bytesSentPerSec,
      ).toBe(250_000);

      analyzerInstance.updateBandwidth("peer-1", NaN);
      expect(
        analyzerInstance.getMetrics().find((m) => m.peerId === "peer-1")
          ?.bytesSentPerSec,
      ).toBe(250_000);

      analyzerInstance.updateBandwidth("peer-1", Infinity);
      expect(
        analyzerInstance.getMetrics().find((m) => m.peerId === "peer-1")
          ?.bytesSentPerSec,
      ).toBe(250_000);

      analyzerInstance.updateBandwidth("peer-1", -Infinity);
      expect(
        analyzerInstance.getMetrics().find((m) => m.peerId === "peer-1")
          ?.bytesSentPerSec,
      ).toBe(250_000);
    });

    it("prevents variance from becoming NaN when malformed telemetry is received", () => {
      analyzerInstance.registerPeer("peer-hog");

      // Populate peer-1 and peer-2 with valid stable samples
      for (let i = 0; i < 6; i++) {
        analyzerInstance.recordACKDelay("peer-1", 10);
        analyzerInstance.recordACKDelay("peer-2", 10);
      }
      analyzerInstance.updateBandwidth("peer-1", 50_000);
      analyzerInstance.updateBandwidth("peer-2", 50_000);

      // Populate peer-hog with valid high-variance samples plus attempted NaN/negative injections
      for (let i = 0; i < 10; i++) {
        analyzerInstance.recordACKDelay("peer-hog", i % 2 === 0 ? 10 : 250);
        // Inject poison telemetry
        analyzerInstance.recordACKDelay("peer-hog", NaN);
        analyzerInstance.recordACKDelay("peer-hog", -999);
        analyzerInstance.recordACKDelay("peer-hog", Infinity);
      }
      analyzerInstance.updateBandwidth("peer-hog", 3_000_000);
      analyzerInstance.updateBandwidth("peer-hog", NaN); // should be rejected

      // Hog detection must succeed and identify peer-hog without variance corruption
      const hogId = analyzerInstance.identifyHog();
      expect(hogId).toBe("peer-hog");

      const hogMetrics = analyzerInstance
        .getMetrics()
        .find((m) => m.peerId === "peer-hog");
      expect(hogMetrics?.isHog).toBe(true);
      expect(hogMetrics?.bytesSentPerSec).toBe(3_000_000);
      // Valid samples should not contain any NaN or negative values
      expect(
        hogMetrics?.ackDelayHistory.every((v) => Number.isFinite(v) && v >= 0),
      ).toBe(true);
    });
  });

  describe("CooperativeQoSEngine active-peer accounting and fair-share calculations", () => {
    let engine: CooperativeQoSEngine;

    beforeEach(() => {
      engine = new CooperativeQoSEngine(defaultPolicy);
    });

    it("does not inflate activePeers when a peer leaves before creating a token bucket", () => {
      engine.addPeer("peer-no-bucket");
      expect(engine.getActivePeers()).toBe(1);
      expect(engine.activePeers).toBe(1);

      // Disconnect immediately without sending any non-priority packet
      engine.removePeer("peer-no-bucket");

      expect(engine.getActivePeers()).toBe(0);
      expect(engine.activePeers).toBe(0);
    });

    it("handles priority-only peers without inflating activePeers after departure", () => {
      engine.addPeer("voip-peer");
      expect(engine.getActivePeers()).toBe(1);

      // VoIP packets bypass token bucket
      const allowed = engine.allowPacket("voip-peer", 500, true);
      expect(allowed).toBe(true);

      // Peer disconnects
      engine.removePeer("voip-peer");
      expect(engine.getActivePeers()).toBe(0);
      expect(engine.activePeers).toBe(0);
    });

    it("guarantees idempotency on repeated join and leave calls", () => {
      // Multiple joins for the same peer
      engine.addPeer("peer-A");
      engine.addPeer("peer-A");
      engine.addPeer("peer-A");
      expect(engine.getActivePeers()).toBe(1);

      engine.addPeer("peer-B");
      expect(engine.getActivePeers()).toBe(2);

      // Multiple leaves for peer-A
      engine.removePeer("peer-A");
      engine.removePeer("peer-A");
      expect(engine.getActivePeers()).toBe(1);
      expect(engine.hasPeer("peer-A")).toBe(false);
      expect(engine.hasPeer("peer-B")).toBe(true);

      // Leave peer-B
      engine.removePeer("peer-B");
      engine.removePeer("peer-B");
      expect(engine.getActivePeers()).toBe(0);
      expect(engine.activePeers).toBe(0);
    });

    it("recalculates fair-share limits correctly when peers join and depart", () => {
      // Available bandwidth: 50 Mbps - 5 Mbps = 45 Mbps * 0.8 = 36 Mbps total fair share
      // 1 peer: 36 Mbps
      engine.addPeer("peer-1");
      expect(engine.getFairShareRate()).toBe(36_000_000);

      // 2 peers: 18 Mbps each
      engine.addPeer("peer-2");
      expect(engine.getFairShareRate()).toBe(18_000_000);

      // 3 peers: 12 Mbps each
      engine.addPeer("peer-3");
      expect(engine.getFairShareRate()).toBe(12_000_000);

      // Peer 2 departs: remaining 2 peers get 18 Mbps each
      engine.removePeer("peer-2");
      expect(engine.getActivePeers()).toBe(2);
      expect(engine.getFairShareRate()).toBe(18_000_000);

      // Peer 1 and 3 depart: 0 peers resets rate to full capacity
      engine.removePeer("peer-1");
      engine.removePeer("peer-3");
      expect(engine.getActivePeers()).toBe(0);
      expect(engine.getFairShareRate()).toBe(defaultPolicy.maxBandwidthBps);
    });

    it("rejects non-priority packets from departed peers without recreating buckets", () => {
      engine.addPeer("peer-1");
      expect(engine.allowPacket("peer-1", 1000, false)).toBe(true);

      engine.removePeer("peer-1");
      expect(engine.allowPacket("peer-1", 1000, false)).toBe(false);
      expect(engine.getActivePeers()).toBe(0);
    });
  });

  describe("qosMeshWorker message handling integration", () => {
    beforeEach(() => {
      handleWorkerMessage({
        data: {
          type: "INIT",
          payload: { policy: defaultPolicy },
        },
      });
    });

    it("cleans up both qosEngine and analyzer on PEER_LEFT", () => {
      handleWorkerMessage({
        data: {
          type: "PEER_JOINED",
          payload: { peerId: "worker-peer-1" },
        },
      });

      expect(analyzer.hasPeer("worker-peer-1")).toBe(true);
      expect(qosEngine?.hasPeer("worker-peer-1")).toBe(true);
      expect(qosEngine?.activePeers).toBe(1);

      handleWorkerMessage({
        data: {
          type: "PEER_LEFT",
          payload: { peerId: "worker-peer-1" },
        },
      });

      expect(analyzer.hasPeer("worker-peer-1")).toBe(false);
      expect(qosEngine?.hasPeer("worker-peer-1")).toBe(false);
      expect(qosEngine?.activePeers).toBe(0);
      expect(
        analyzer.getMetrics().some((m) => m.peerId === "worker-peer-1"),
      ).toBe(false);
    });

    it("ignores TELEMETRY_UPDATE for departed peers in worker", () => {
      handleWorkerMessage({
        data: {
          type: "PEER_JOINED",
          payload: { peerId: "worker-peer-2" },
        },
      });

      handleWorkerMessage({
        data: {
          type: "PEER_LEFT",
          payload: { peerId: "worker-peer-2" },
        },
      });

      // Late telemetry message sent by network socket
      handleWorkerMessage({
        data: {
          type: "TELEMETRY_UPDATE",
          payload: {
            peerId: "worker-peer-2",
            rtt: 80,
            ackDelay: 25,
            bytesPerSec: 100_000,
          },
        },
      });

      expect(analyzer.hasPeer("worker-peer-2")).toBe(false);
      expect(
        analyzer.getMetrics().some((m) => m.peerId === "worker-peer-2"),
      ).toBe(false);
    });
  });

  describe("TokenBucket Bandwidth Conversion & Refill Rate Accuracy (#10082)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("validates conversion constants (8 bits/byte, 1000 ms/sec, divisor 8000)", () => {
      expect(BITS_PER_BYTE).toBe(8);
      expect(MS_PER_SECOND).toBe(1000);
      expect(BPS_TO_BYTES_PER_MS).toBe(8000);

      // 1 Mbps = 1,000,000 bps = 125,000 bytes per second = 125 bytes/ms
      const oneMbpsBps = 1_000_000;
      const bucket = new TokenBucket(1_000_000, oneMbpsBps);

      expect(bucket.getRefillRateBytesPerMs()).toBe(125);
      expect(bucket.getRefillRateBytesPerMs() * 1000).toBe(125_000);
      expect(bucket.refillRate).toBe(125);
    });

    it("enforces that 1 Mbps corresponds exactly to 125,000 bytes per second of refill", () => {
      const capacity = 500_000;
      const rate1Mbps = 1_000_000;
      const bucket = new TokenBucket(capacity, rate1Mbps);

      // Drain all initial tokens
      expect(bucket.consume(capacity)).toBe(true);
      expect(bucket.consume(1)).toBe(false);

      // Advance time by exactly 1000 ms (1 second)
      jest.advanceTimersByTime(1000);

      // In 1 second at 1 Mbps, exactly 125,000 bytes must be refilled
      expect(bucket.consume(125_000)).toBe(true);
      // Extra byte should fail
      expect(bucket.consume(1)).toBe(false);
    });

    it("accurately refills tokens across multiple bandwidth configurations", () => {
      const testCases = [
        { name: "500 kbps", bps: 500_000, expectedBytesPerSec: 62_500 },
        { name: "2 Mbps", bps: 2_000_000, expectedBytesPerSec: 250_000 },
        { name: "8 Mbps", bps: 8_000_000, expectedBytesPerSec: 1_000_000 },
        { name: "50 Mbps", bps: 50_000_000, expectedBytesPerSec: 6_250_000 },
      ];

      for (const tc of testCases) {
        const capacity = tc.expectedBytesPerSec * 2;
        const bucket = new TokenBucket(capacity, tc.bps);

        // Drain bucket
        expect(bucket.consume(capacity)).toBe(true);

        // Advance 2 seconds
        jest.advanceTimersByTime(2000);

        // Should have refilled 2 seconds worth of bytes
        const expected2SecBytes = tc.expectedBytesPerSec * 2;
        expect(bucket.consume(expected2SecBytes)).toBe(true);
        expect(bucket.consume(1)).toBe(false);
      }
    });

    it("preserves correct units when dynamically updating rate with setRate()", () => {
      const bucket = new TokenBucket(2_000_000, 1_000_000); // 1 Mbps initially
      expect(bucket.consume(2_000_000)).toBe(true); // drain

      // Update rate to 4 Mbps (500,000 bytes/sec = 500 bytes/ms)
      bucket.setRate(4_000_000);
      expect(bucket.getRefillRateBytesPerMs()).toBe(500);

      jest.advanceTimersByTime(1000); // 1 second
      expect(bucket.consume(500_000)).toBe(true);
      expect(bucket.consume(1)).toBe(false);

      // Throttle dynamically down to 256 kbps (32,000 bytes/sec = 32 bytes/ms)
      bucket.setRate(256_000);
      expect(bucket.getRefillRateBytesPerMs()).toBe(32);

      jest.advanceTimersByTime(1000); // 1 second
      expect(bucket.consume(32_000)).toBe(true);
      expect(bucket.consume(1)).toBe(false);
    });

    it("enforces accurate fair-share bandwidth limits in CooperativeQoSEngine", () => {
      // 50 Mbps max, 10 Mbps reserve -> 40 Mbps available * 0.8 factor = 32 Mbps total fair share
      const policy: QoSPolicy = {
        maxBandwidthBps: 50_000_000,
        voipReserveBps: 10_000_000,
        fairShareFactor: 0.8,
      };
      const engine = new CooperativeQoSEngine(policy);

      // 2 peers: 32 Mbps / 2 = 16 Mbps each
      // 16 Mbps = 2,000,000 bytes/sec = 2,000 bytes/ms
      engine.addPeer("peer-1");
      engine.addPeer("peer-2");

      expect(engine.getFairShareRate()).toBe(16_000_000);

      // Trigger bucket creation and drain for peer-1 (default capacity 1MB = 1024*1024 bytes)
      const defaultCapacity = 1024 * 1024;
      expect(engine.allowPacket("peer-1", defaultCapacity, false)).toBe(true);
      expect(engine.allowPacket("peer-1", 1, false)).toBe(false);

      // Advance by 500 ms (0.5 second)
      // At 16 Mbps (2,000 bytes/ms), 500 ms should refill 1,000,000 bytes
      jest.advanceTimersByTime(500);

      expect(engine.allowPacket("peer-1", 1_000_000, false)).toBe(true);
      expect(engine.allowPacket("peer-1", 1, false)).toBe(false);
    });
  });
});
