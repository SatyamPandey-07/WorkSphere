import {
  calculateRFactor,
  calculateMosFromRFactor,
  estimateMos,
  getTierForMos,
  extractNetworkMetricsFromStats,
  WebRtcMosQualityMonitor,
  createWebRtcMosMonitor,
  globalMosQualityMonitor,
  QUALITY_TIERS,
} from "@/lib/webrtcMosQualityMonitor";

describe("webrtcMosQualityMonitor", () => {
  describe("Mathematical Formulae & Core Estimation", () => {
    describe("calculateRFactor", () => {
      it("returns approximately 94.2 for perfect network conditions", () => {
        const r = calculateRFactor(0, 0, 0);
        expect(r).toBeCloseTo(94.2, 1);
      });

      it("decreases with moderate latency and jitter below 177ms one-way delay", () => {
        // RTT 60ms, jitter 10ms -> one-way delay = 30 + 20 = 50ms
        const r = calculateRFactor(60, 10, 0);
        expect(r).toBeLessThan(94.2);
        expect(r).toBeGreaterThan(90);
      });

      it("penalizes heavily when one-way delay exceeds 177.3ms threshold", () => {
        // RTT 300ms, jitter 50ms -> one-way delay = 150 + 100 = 250ms
        const r = calculateRFactor(300, 50, 0);
        expect(r).toBeLessThan(85);
      });

      it("severely penalizes high packet loss", () => {
        // 10% packet loss
        const r = calculateRFactor(50, 5, 0.1);
        expect(r).toBeLessThan(55);
      });

      it("clamps R-factor between 0 and 100", () => {
        expect(calculateRFactor(2000, 500, 0.9)).toBe(0);
        expect(calculateRFactor(0, 0, 0)).toBeLessThanOrEqual(100);
      });
    });

    describe("calculateMosFromRFactor", () => {
      it("returns 1.0 for R <= 0", () => {
        expect(calculateMosFromRFactor(0)).toBe(1.0);
        expect(calculateMosFromRFactor(-10)).toBe(1.0);
      });

      it("returns 4.5 for R >= 100", () => {
        expect(calculateMosFromRFactor(100)).toBe(4.5);
        expect(calculateMosFromRFactor(120)).toBe(4.5);
      });

      it("calculates realistic MOS for good R-factor (~85 to 90)", () => {
        const mos = calculateMosFromRFactor(90);
        expect(mos).toBeGreaterThanOrEqual(4.1);
        expect(mos).toBeLessThanOrEqual(4.5);
      });

      it("calculates degraded MOS for poor R-factor (~50)", () => {
        const mos = calculateMosFromRFactor(50);
        expect(mos).toBeGreaterThanOrEqual(2.0);
        expect(mos).toBeLessThan(3.0);
      });
    });

    describe("estimateMos", () => {
      it("returns both mos and rFactor rounded properly", () => {
        const result = estimateMos(40, 5, 0.01);
        expect(result.mos).toBeDefined();
        expect(result.rFactor).toBeDefined();
        expect(result.mos).toBeGreaterThan(3.5);
      });
    });

    describe("getTierForMos", () => {
      it("maps scores >= 4.1 to excellent", () => {
        expect(getTierForMos(4.3).name).toBe("excellent");
      });

      it("maps scores between 3.7 and 4.09 to good", () => {
        expect(getTierForMos(3.8).name).toBe("good");
      });

      it("maps scores between 3.1 and 3.69 to fair", () => {
        expect(getTierForMos(3.4).name).toBe("fair");
      });

      it("maps scores between 2.5 and 3.09 to poor", () => {
        expect(getTierForMos(2.8).name).toBe("poor");
      });

      it("maps scores < 2.5 to critical", () => {
        expect(getTierForMos(2.1).name).toBe("critical");
      });
    });
  });

  describe("RTCStatsReport Extraction", () => {
    it("extracts candidate-pair RTT correctly", () => {
      const statsMap = new Map();
      statsMap.set("pair1", {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.035, // 35 ms
      });

      const metrics = extractNetworkMetricsFromStats(statsMap as any);
      expect(metrics.rttMs).toBe(35);
    });

    it("extracts remote-inbound-rtp loss, rtt, and jitter", () => {
      const statsMap = new Map();
      statsMap.set("remote1", {
        type: "remote-inbound-rtp",
        roundTripTime: 0.045,
        jitter: 0.008,
        packetsLost: 12,
        fractionLost: 0.02,
      });

      const metrics = extractNetworkMetricsFromStats(statsMap as any);
      expect(metrics.rttMs).toBe(45);
      expect(metrics.jitterMs).toBe(8);
      expect(metrics.packetsLost).toBe(12);
      expect(metrics.fractionLost).toBe(0.02);
    });

    it("gracefully handles reports with no recognized stats", () => {
      const emptyMap = new Map();
      const metrics = extractNetworkMetricsFromStats(emptyMap as any);
      expect(metrics.rttMs).toBeUndefined();
      expect(metrics.jitterMs).toBeUndefined();
    });
  });

  describe("WebRtcMosQualityMonitor Class", () => {
    let monitor: WebRtcMosQualityMonitor;

    beforeEach(() => {
      monitor = new WebRtcMosQualityMonitor({
        emaAlpha: 0.5,
        upgradeConsecutiveRequired: 2,
        hysteresisBuffer: 0.1,
      });
    });

    it("initializes with default excellent tier", () => {
      expect(monitor.getCurrentTier().name).toBe("excellent");
      expect(monitor.getRecommendations().video.enabled).toBe(true);
    });

    it("smooths metrics using EMA and calculates MOS", () => {
      const result = monitor.updateMetrics({
        rttMs: 40,
        jitterMs: 5,
        packetsLost: 0,
        packetsSent: 100,
      });

      expect(result.mos).toBeGreaterThan(4.0);
      expect(result.smoothed.rttMs).toBe(40);
      expect(result.smoothed.lossRatio).toBe(0);
    });

    it("immediately downgrades tier when connection degrades to critical", () => {
      // Feed severe lag and loss
      const result = monitor.updateMetrics({
        rttMs: 800,
        jitterMs: 120,
        packetsLost: 40,
        packetsSent: 100,
      });

      expect(result.transition).toBe("downgrade");
      expect(monitor.getCurrentTier().name).toBe("critical");
      expect(monitor.getRecommendations().video.enabled).toBe(false);
    });

    it("requires consecutive stable samples above hysteresis buffer to upgrade", () => {
      // 1. Force downgrade to fair tier (RTT 140ms, jitter 15ms, 4% loss)
      const degraded = monitor.updateMetrics({
        rttMs: 140,
        jitterMs: 15,
        packetsLost: 4,
        packetsSent: 100,
      });
      expect(degraded.transition).toBe("downgrade");
      const downgradedTier = monitor.getCurrentTier().name;
      expect(["fair", "poor", "critical"]).toContain(downgradedTier);

      // 2. Feed single good sample: should NOT upgrade immediately due to upgradeConsecutiveRequired = 2
      const firstRecovery = monitor.updateMetrics({
        rttMs: 15,
        jitterMs: 2,
        packetsLost: 0,
        packetsSent: 1000,
      });
      expect(firstRecovery.transition).toBe("stable");
      expect(monitor.getCurrentTier().name).toBe(downgradedTier);

      // 3. Feed subsequent good samples: EMA stabilizes and triggers upgrade
      let upgraded = false;
      for (let i = 0; i < 3; i++) {
        const res = monitor.updateMetrics({
          rttMs: 15,
          jitterMs: 2,
          packetsLost: 0,
          packetsSent: 1000,
        });
        if (res.transition === "upgrade") {
          upgraded = true;
          break;
        }
      }
      expect(upgraded).toBe(true);
      expect(monitor.getCurrentTier().name).not.toBe(downgradedTier);
    });

    it("emits events to subscribers on metric updates", () => {
      const events: any[] = [];
      const unsubscribe = monitor.subscribe((res) => {
        events.push(res);
      });

      monitor.updateMetrics({ rttMs: 30, jitterMs: 5 });
      expect(events.length).toBe(1);

      unsubscribe();
      monitor.updateMetrics({ rttMs: 30, jitterMs: 5 });
      expect(events.length).toBe(1);
    });

    it("resets back to initial configuration and empty smoothing", () => {
      monitor.updateMetrics({ rttMs: 500, jitterMs: 100, packetsLost: 30, packetsSent: 100 });
      expect(monitor.getCurrentTier().name).not.toBe("excellent");

      monitor.reset();
      expect(monitor.getCurrentTier().name).toBe("excellent");
      expect(monitor.getCurrentResult()).toBeNull();
    });

    it("applies constraints to RTCPeerConnection senders", async () => {
      const mockVideoSender = {
        track: { kind: "video" },
        getParameters: jest.fn().mockReturnValue({ encodings: [{}] }),
        setParameters: jest.fn().mockResolvedValue(undefined),
      };
      const mockAudioSender = {
        track: { kind: "audio" },
        getParameters: jest.fn().mockReturnValue({ encodings: [{}] }),
        setParameters: jest.fn().mockResolvedValue(undefined),
      };

      const mockPc = {
        getSenders: jest.fn().mockReturnValue([mockVideoSender, mockAudioSender]),
      } as unknown as RTCPeerConnection;

      const applied = await monitor.applyToPeerConnection(mockPc);
      expect(applied).toBe(true);
      expect(mockVideoSender.setParameters).toHaveBeenCalled();
      expect(mockAudioSender.setParameters).toHaveBeenCalled();
    });
  });

  describe("Factory and Singleton Exports", () => {
    it("creates custom monitor instance via createWebRtcMosMonitor", () => {
      const custom = createWebRtcMosMonitor({ initialTier: "fair" });
      expect(custom.getCurrentTier().name).toBe("fair");
    });

    it("exports default globalMosQualityMonitor instance", () => {
      expect(globalMosQualityMonitor).toBeInstanceOf(WebRtcMosQualityMonitor);
    });
  });
});
