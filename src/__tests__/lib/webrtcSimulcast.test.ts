import {
  configureSimulcastSender,
  computeScaleResolutionDownBy,
  createSimulcastEncodings,
  extractRTCPStats,
  evaluateNetworkCondition,
  setHighLayerActive,
  SimulcastAdaptiveController,
  SIMULCAST_BITRATE_LADDER,
} from "@/lib/webrtcSimulcast";
import { attachSimulcastVideoTrack } from "@/lib/webrtc/meshConnection";

describe("WebRTC Simulcast & Adaptive Degradation", () => {
  function createMockTrack(kind: "video" | "audio", height = 720): MediaStreamTrack {
    return {
      kind,
      id: `${kind}-track-${Math.random()}`,
      enabled: true,
      readyState: "live",
      getSettings: () => ({ width: Math.round((height * 16) / 9), height, frameRate: 30 }),
      stop: jest.fn(),
    } as unknown as MediaStreamTrack;
  }

  function createMockSender(
    kind: "video" | "audio" = "video",
    initialEncodings?: RTCRtpEncodingParameters[],
  ): {
    sender: RTCRtpSender;
    getParameters: jest.Mock;
    setParameters: jest.Mock;
    track: MediaStreamTrack;
  } {
    const track = createMockTrack(kind);
    let params: RTCRtpParameters = {
      codecs: [],
      headerExtensions: [],
      rtcp: { cname: "cname", reducedSize: false },
      transactionId: "tx-1",
      encodings: initialEncodings || [
        { rid: "high", active: true },
        { rid: "medium", active: true },
        { rid: "low", active: true },
      ],
    };

    const getParameters = jest.fn(() => JSON.parse(JSON.stringify(params)));
    const setParameters = jest.fn(async (newParams: RTCRtpParameters) => {
      params = JSON.parse(JSON.stringify(newParams));
      return Promise.resolve();
    });

    const sender = {
      track,
      getParameters,
      setParameters,
    } as unknown as RTCRtpSender;

    return { sender, getParameters, setParameters, track };
  }

  function buildStatsReport(options: {
    rttMs?: number;
    roundTripTime?: number; // seconds
    currentRoundTripTime?: number; // seconds
    fractionLost?: number; // 0.0 - 1.0 or percentage
    packetsLost?: number;
    packetsReceived?: number;
    packetsSent?: number;
    jitter?: number; // seconds
    jitterMs?: number;
  }): RTCStatsReport {
    const map = new Map<string, any>();

    if (
      options.currentRoundTripTime !== undefined ||
      options.rttMs !== undefined
    ) {
      map.set("candidate-pair-1", {
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        currentRoundTripTime:
          options.currentRoundTripTime !== undefined
            ? options.currentRoundTripTime
            : options.rttMs !== undefined
              ? options.rttMs / 1000
              : undefined,
      });
    }

    if (
      options.roundTripTime !== undefined ||
      options.fractionLost !== undefined ||
      options.packetsLost !== undefined ||
      options.jitter !== undefined ||
      options.jitterMs !== undefined
    ) {
      map.set("remote-inbound-1", {
        type: "remote-inbound-rtp",
        roundTripTime:
          options.roundTripTime !== undefined
            ? options.roundTripTime
            : options.rttMs !== undefined
              ? options.rttMs / 1000
              : undefined,
        fractionLost: options.fractionLost,
        packetsLost: options.packetsLost,
        jitter:
          options.jitter !== undefined
            ? options.jitter
            : options.jitterMs !== undefined
              ? options.jitterMs / 1000
              : undefined,
      });
    }

    if (options.packetsReceived !== undefined) {
      map.set("inbound-1", {
        type: "inbound-rtp",
        packetsReceived: options.packetsReceived,
        packetsLost: options.packetsLost,
      });
    }

    if (options.packetsSent !== undefined) {
      map.set("outbound-1", {
        type: "outbound-rtp",
        packetsSent: options.packetsSent,
      });
    }

    return map as unknown as RTCStatsReport;
  }

  function createMockPeerConnection(
    getStatsFn?: () => Promise<RTCStatsReport>,
  ): RTCPeerConnection {
    return {
      connectionState: "connected",
      signalingState: "stable",
      getStats: getStatsFn || jest.fn().mockResolvedValue(new Map()),
      getSenders: jest.fn().mockReturnValue([]),
      addTrack: jest.fn(),
      close: jest.fn(),
    } as unknown as RTCPeerConnection;
  }

  describe("1. Simulcast configuration", () => {
    it("configures three encoding layers with exact bitrate ladder, framerate, and scale factor", async () => {
      const { sender, setParameters } = createMockSender("video", []);

      await configureSimulcastSender(sender, { width: 1280, height: 720 });

      expect(setParameters).toHaveBeenCalledTimes(1);
      const passedParams: RTCRtpParameters = setParameters.mock.calls[0][0];
      const encodings = passedParams.encodings;

      expect(encodings).toHaveLength(3);

      // High layer: 1280x720, 30fps, 1500 kbps (1,500,000 bps)
      const high = encodings.find((e) => e.rid === "high");
      expect(high).toBeDefined();
      expect(high?.maxBitrate).toBe(1_500_000);
      expect(high?.maxFramerate).toBe(30);
      expect(high?.scaleResolutionDownBy).toBe(1.0);
      expect(high?.active).toBe(true);

      // Medium layer: 640x360, 20fps, 500 kbps (500,000 bps)
      const medium = encodings.find((e) => e.rid === "medium");
      expect(medium).toBeDefined();
      expect(medium?.maxBitrate).toBe(500_000);
      expect(medium?.maxFramerate).toBe(20);
      expect(medium?.scaleResolutionDownBy).toBe(2.0);
      expect(medium?.active).toBe(true);

      // Low layer: 320x180, 15fps, 150 kbps (150,000 bps)
      const low = encodings.find((e) => e.rid === "low");
      expect(low).toBeDefined();
      expect(low?.maxBitrate).toBe(150_000);
      expect(low?.maxFramerate).toBe(15);
      expect(low?.scaleResolutionDownBy).toBe(4.0);
      expect(low?.active).toBe(true);
    });

    it("dynamically computes scaleResolutionDownBy when source resolution is higher (e.g. 1080p)", () => {
      // 1080p camera source
      expect(computeScaleResolutionDownBy(1080, 720)).toBe(1.5);
      expect(computeScaleResolutionDownBy(1080, 360)).toBe(3.0);
      expect(computeScaleResolutionDownBy(1080, 180)).toBe(6.0);

      const encodings = createSimulcastEncodings({ width: 1920, height: 1080 });
      expect(encodings[0].scaleResolutionDownBy).toBe(1.5);
      expect(encodings[1].scaleResolutionDownBy).toBe(3.0);
      expect(encodings[2].scaleResolutionDownBy).toBe(6.0);
    });

    it("preserves audio safety by never modifying audio sender encodings", async () => {
      const { sender, setParameters } = createMockSender("audio", [
        { maxBitrate: 64_000, active: true },
      ]);

      await configureSimulcastSender(sender);

      // configureSimulcastSender must NOT touch audio senders
      expect(setParameters).not.toHaveBeenCalled();
    });

    it("exposes the default SIMULCAST_BITRATE_LADDER with 3 tiers", () => {
      expect(SIMULCAST_BITRATE_LADDER).toHaveLength(3);
      expect(SIMULCAST_BITRATE_LADDER[0].rid).toBe("high");
      expect(SIMULCAST_BITRATE_LADDER[1].rid).toBe("medium");
      expect(SIMULCAST_BITRATE_LADDER[2].rid).toBe("low");
    });

    it("toggles high layer activation idempotently using setHighLayerActive", async () => {
      const { sender, setParameters } = createMockSender("video");
      const changed = await setHighLayerActive(sender, false);
      expect(changed).toBe(true);
      expect(setParameters).toHaveBeenCalledTimes(1);

      // Calling again with the same value is a no-op
      const changedAgain = await setHighLayerActive(sender, false);
      expect(changedAgain).toBe(false);
      expect(setParameters).toHaveBeenCalledTimes(1);
    });
  });

  describe("2. Packet loss degradation", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("disables high layer when packet loss > 8%, keeps medium and low active, and leaves audio untouched", async () => {
      const videoSenderMock = createMockSender("video");
      const audioSenderMock = createMockSender("audio");

      let report = buildStatsReport({ fractionLost: 0.02, rttMs: 50 }); // healthy initially
      const pc = createMockPeerConnection(jest.fn(async () => report));

      const controller = new SimulcastAdaptiveController(pc, videoSenderMock.sender, {
        pollIntervalMs: 2000,
        recoveryThresholdMs: 15000,
      });

      controller.start();

      // Healthy tick (loss 2% <= 8%)
      await jest.advanceTimersByTimeAsync(2000);
      expect(controller.getState()).toBe("NORMAL");
      expect(videoSenderMock.setParameters).not.toHaveBeenCalled();

      // Poor network: packet loss = 10% (> 8%)
      report = buildStatsReport({ fractionLost: 0.10, rttMs: 50 });
      await jest.advanceTimersByTimeAsync(2000);

      // High layer must now be disabled
      expect(controller.getState()).toBe("DEGRADED");
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);

      const updatedParams = videoSenderMock.setParameters.mock.calls[0][0];
      const high = updatedParams.encodings.find((e: any) => e.rid === "high");
      const medium = updatedParams.encodings.find((e: any) => e.rid === "medium");
      const low = updatedParams.encodings.find((e: any) => e.rid === "low");

      expect(high.active).toBe(false);
      expect(medium.active).toBe(true);
      expect(low.active).toBe(true);

      // Audio sender was completely untouched
      expect(audioSenderMock.setParameters).not.toHaveBeenCalled();

      controller.destroy();
    });
  });

  describe("3. RTT degradation", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("disables high layer when RTT > 350ms", async () => {
      const videoSenderMock = createMockSender("video");
      // Initial healthy report
      let report = buildStatsReport({ rttMs: 80, fractionLost: 0 });
      const pc = createMockPeerConnection(jest.fn(async () => report));

      const controller = new SimulcastAdaptiveController(pc, videoSenderMock.sender, {
        pollIntervalMs: 2000,
      });
      controller.start();

      await jest.advanceTimersByTimeAsync(2000);
      expect(controller.getState()).toBe("NORMAL");

      // RTT increases to 400ms (> 350ms)
      report = buildStatsReport({ roundTripTime: 0.400, fractionLost: 0 });
      await jest.advanceTimersByTimeAsync(2000);

      expect(controller.getState()).toBe("DEGRADED");
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);
      const passed = videoSenderMock.setParameters.mock.calls[0][0];
      expect(passed.encodings.find((e: any) => e.rid === "high").active).toBe(false);

      controller.destroy();
    });
  });

  describe("4. Combined degradation & idempotency", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("degrades only once when both RTT and packet loss are high, and does not repeatedly call setParameters()", async () => {
      const videoSenderMock = createMockSender("video");
      let report = buildStatsReport({ fractionLost: 0.15, rttMs: 450 }); // both > thresholds
      const pc = createMockPeerConnection(jest.fn(async () => report));

      const controller = new SimulcastAdaptiveController(pc, videoSenderMock.sender, {
        pollIntervalMs: 2000,
      });
      controller.start();

      // First bad sample -> degrades
      await jest.advanceTimersByTimeAsync(2000);
      expect(controller.getState()).toBe("DEGRADED");
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);

      // Second consecutive bad sample -> already degraded, MUST NOT call setParameters again
      report = buildStatsReport({ fractionLost: 0.18, rttMs: 500 });
      await jest.advanceTimersByTimeAsync(2000);
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);

      // Third consecutive bad sample -> still no unnecessary calls
      await jest.advanceTimersByTimeAsync(2000);
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);

      controller.destroy();
    });
  });

  describe("5. Recovery after > 15 consecutive seconds", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("restores high layer only after connection remains continuously healthy for > 15s", async () => {
      const videoSenderMock = createMockSender("video");
      let report = buildStatsReport({ fractionLost: 0.12, rttMs: 100 }); // degraded initially
      const pc = createMockPeerConnection(jest.fn(async () => report));

      const controller = new SimulcastAdaptiveController(pc, videoSenderMock.sender, {
        pollIntervalMs: 2000,
        recoveryThresholdMs: 15000,
      });
      controller.start();

      // Degrade
      await jest.advanceTimersByTimeAsync(2000);
      expect(controller.getState()).toBe("DEGRADED");
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);

      // Now network conditions become healthy (loss = 1%, RTT = 50ms)
      report = buildStatsReport({ fractionLost: 0.01, rttMs: 50 });

      // After 1 healthy sample (t = 0s relative to recovery start): should NOT recover yet
      await jest.advanceTimersByTimeAsync(2000);
      expect(controller.getState()).toBe("DEGRADED");
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);

      // Advance through 14 seconds of healthy samples (7 more 2s intervals)
      for (let i = 0; i < 7; i++) {
        await jest.advanceTimersByTimeAsync(2000);
      }
      // Total elapsed healthy time is 14s <= 15s -> still DEGRADED
      expect(controller.getState()).toBe("DEGRADED");
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);

      // Advance 1 more interval (2s) -> 16s healthy (> 15s threshold)
      await jest.advanceTimersByTimeAsync(2000);
      expect(controller.getState()).toBe("NORMAL");
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(2);

      const recoveredParams = videoSenderMock.setParameters.mock.calls[1][0];
      const high = recoveredParams.encodings.find((e: any) => e.rid === "high");
      expect(high.active).toBe(true);

      // Subsequent healthy sample should NOT re-invoke setParameters
      await jest.advanceTimersByTimeAsync(2000);
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(2);

      controller.destroy();
    });
  });

  describe("6. Recovery interruption", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("resets recovery window when a bad sample occurs, preventing premature recovery", async () => {
      const videoSenderMock = createMockSender("video");
      let report = buildStatsReport({ fractionLost: 0.15, rttMs: 100 }); // start degraded
      const pc = createMockPeerConnection(jest.fn(async () => report));

      const controller = new SimulcastAdaptiveController(pc, videoSenderMock.sender, {
        pollIntervalMs: 2000,
        recoveryThresholdMs: 15000,
      });
      controller.start();

      await jest.advanceTimersByTimeAsync(2000);
      expect(controller.getState()).toBe("DEGRADED");
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);

      // 3 healthy samples (6s healthy elapsed)
      report = buildStatsReport({ fractionLost: 0.01, rttMs: 40 });
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(2000);
      }
      expect(controller.getState()).toBe("DEGRADED");

      // Sudden bad sample at 8s!
      report = buildStatsReport({ fractionLost: 0.12, rttMs: 40 });
      await jest.advanceTimersByTimeAsync(2000);
      expect(controller.getState()).toBe("DEGRADED");
      expect(controller.getHealthySince()).toBeNull();
      expect(controller.getConsecutiveHealthySamples()).toBe(0);

      // Healthy again: must achieve full 15s from THIS point
      report = buildStatsReport({ fractionLost: 0.01, rttMs: 40 });
      // 1st healthy sample after reset (elapsed = 0s)
      await jest.advanceTimersByTimeAsync(2000);
      // 7 more samples (total 14s elapsed since 1st healthy sample <= 15s)
      for (let i = 0; i < 7; i++) {
        await jest.advanceTimersByTimeAsync(2000);
      }
      expect(controller.getState()).toBe("DEGRADED"); // Not restored prematurely (14s <= 15s)
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(1);

      // Now cross the 15s boundary (> 15s elapsed: 16s)
      await jest.advanceTimersByTimeAsync(2000);
      expect(controller.getState()).toBe("NORMAL");
      expect(videoSenderMock.setParameters).toHaveBeenCalledTimes(2);

      controller.destroy();
    });
  });

  describe("7. Cleanup & duplicate interval prevention", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("stops polling on cleanup and prevents duplicate polling intervals", async () => {
      const videoSenderMock = createMockSender("video");
      const getStatsMock = jest.fn().mockResolvedValue(new Map());
      const pc = createMockPeerConnection(getStatsMock);

      const controller = new SimulcastAdaptiveController(pc, videoSenderMock.sender, {
        pollIntervalMs: 2000,
      });

      // Calling start multiple times does not create duplicate intervals
      controller.start();
      controller.start();
      controller.start();

      await jest.advanceTimersByTimeAsync(2000);
      expect(getStatsMock).toHaveBeenCalledTimes(1);

      // Cleanup
      controller.destroy();

      // Advancing time further should NOT invoke getStats anymore
      await jest.advanceTimersByTimeAsync(6000);
      expect(getStatsMock).toHaveBeenCalledTimes(1);
    });

    it("stops polling automatically when peer connection is closed", async () => {
      const videoSenderMock = createMockSender("video");
      const getStatsMock = jest.fn().mockResolvedValue(new Map());
      const pc = {
        connectionState: "connected",
        signalingState: "stable",
        getStats: getStatsMock,
      } as unknown as RTCPeerConnection;

      const controller = new SimulcastAdaptiveController(pc, videoSenderMock.sender, {
        pollIntervalMs: 2000,
      });
      controller.start();

      await jest.advanceTimersByTimeAsync(2000);
      expect(getStatsMock).toHaveBeenCalledTimes(1);

      // Connection closes
      (pc as any).connectionState = "closed";

      await jest.advanceTimersByTimeAsync(2000);
      // Next intervals should not call getStats because controller self-destructed
      await jest.advanceTimersByTimeAsync(6000);
      expect(getStatsMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("8. Missing stats & delta packet loss", () => {
    it("handles missing RTT, jitter, and packet loss without crashing", () => {
      const emptyReport = new Map() as unknown as RTCStatsReport;
      const { stats } = extractRTCPStats(emptyReport);

      expect(stats.packetLossFraction).toBeUndefined();
      expect(stats.rttMs).toBeUndefined();
      expect(stats.jitterMs).toBeUndefined();

      const evaluation = evaluateNetworkCondition(stats);
      expect(evaluation.isBadSample).toBe(false);
      expect(evaluation.isHighLoss).toBe(false);
      expect(evaluation.isHighRtt).toBe(false);
    });

    it("calculates meaningful delta packet loss when browser only exposes cumulative counters", () => {
      // First report: 10 lost, 90 received (10/100 = 10%)
      const report1 = buildStatsReport({ packetsLost: 10, packetsReceived: 90 });
      const res1 = extractRTCPStats(report1);
      expect(res1.stats.packetLossFraction).toBeCloseTo(0.10, 2);

      const report2 = buildStatsReport({ packetsLost: 12, packetsReceived: 188 });
      const res2 = extractRTCPStats(report2, res1.cumulative);
      expect(res2.stats.packetLossFraction).toBeCloseTo(0.02, 2);
    });

    it("strictly isolates video statistics and ignores audio stats", () => {
      const map = new Map<string, any>();
      // Audio stat with 50% packet loss and 800ms RTT
      map.set("audio-inbound", {
        type: "remote-inbound-rtp",
        kind: "audio",
        fractionLost: 0.5,
        roundTripTime: 0.8,
      });
      // Video stat with 0% packet loss and 50ms RTT
      map.set("video-inbound", {
        type: "remote-inbound-rtp",
        kind: "video",
        fractionLost: 0.0,
        roundTripTime: 0.05,
      });

      const { stats } = extractRTCPStats(map as unknown as RTCStatsReport);
      expect(stats.packetLossFraction).toBe(0.0);
      expect(stats.rttMs).toBe(50);
    });

    it("queries videoSender.getStats() when available", async () => {
      const senderMock = createMockSender("video");
      const senderGetStats = jest.fn().mockResolvedValue(new Map());
      (senderMock.sender as any).getStats = senderGetStats;

      const pcGetStats = jest.fn().mockResolvedValue(new Map());
      const pc = createMockPeerConnection(pcGetStats);

      const controller = new SimulcastAdaptiveController(pc, senderMock.sender);
      await controller.pollStats();

      expect(senderGetStats).toHaveBeenCalledTimes(1);
      expect(pcGetStats).not.toHaveBeenCalled();
      controller.destroy();
    });

    it("updates pre-existing encodings in-place when present", async () => {
      const existingEncodings = [
        { rid: "high", active: true, maxBitrate: 100 },
        { rid: "medium", active: true, maxBitrate: 50 },
        { rid: "low", active: true, maxBitrate: 20 },
      ];
      const { sender, setParameters } = createMockSender("video", existingEncodings);

      await configureSimulcastSender(sender);

      expect(setParameters).toHaveBeenCalledTimes(1);
      const params = setParameters.mock.calls[0][0];
      expect(params.encodings[0].maxBitrate).toBe(1_500_000);
      expect(params.encodings[0].rid).toBe("high");
      expect(params.encodings[1].maxBitrate).toBe(500_000);
      expect(params.encodings[2].maxBitrate).toBe(150_000);
    });
  });

  describe("9. Mesh Connection Helper attachSimulcastVideoTrack", () => {
    it("attaches video track and returns active controller", async () => {
      const senderMock = createMockSender("video");
      const track = createMockTrack("video");
      const stream = { getTracks: () => [track] } as unknown as MediaStream;

      const pc = {
        connectionState: "connected",
        signalingState: "stable",
        addTrack: jest.fn().mockReturnValue(senderMock.sender),
        getSenders: jest.fn().mockReturnValue([senderMock.sender]),
        getStats: jest.fn().mockResolvedValue(new Map()),
      } as unknown as RTCPeerConnection;

      const { sender, controller } = await attachSimulcastVideoTrack(pc, track, stream);

      expect(sender).toBe(senderMock.sender);
      expect(controller).toBeInstanceOf(SimulcastAdaptiveController);
      expect(controller.getState()).toBe("NORMAL");

      controller.destroy();
    });
  });
});
