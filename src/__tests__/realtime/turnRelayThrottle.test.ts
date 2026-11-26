import {
  detectCandidatePairRelay,
  DataChannelRateLimiter,
  RELAY_BANDWIDTH_BUDGET_BYTES_PER_SEC,
  RELAY_BURST_CAPACITY_BYTES,
  RELAY_OPTIMIZED_AUDIO_BITRATE_BPS,
  DIRECT_RESTORED_AUDIO_BITRATE_BPS,
  RELAY_WHITEBOARD_THROTTLE_MS,
  DIRECT_WHITEBOARD_THROTTLE_MS,
} from "@/lib/realtime/webrtc/meshConnection";

describe("WebRTC TURN Relay Bandwidth Throttle & Rate Limiter (#9727)", () => {
  describe("detectCandidatePairRelay", () => {
    it("detects direct connection when selected local & remote candidates are host or srflx", () => {
      const statsMap = new Map<string, any>();
      statsMap.set("transport-1", {
        type: "transport",
        selectedCandidatePairId: "pair-1",
      });
      statsMap.set("pair-1", {
        type: "candidate-pair",
        id: "pair-1",
        state: "succeeded",
        localCandidateId: "cand-local",
        remoteCandidateId: "cand-remote",
      });
      statsMap.set("cand-local", {
        type: "local-candidate",
        id: "cand-local",
        candidateType: "host",
      });
      statsMap.set("cand-remote", {
        type: "remote-candidate",
        id: "cand-remote",
        candidateType: "srflx",
      });

      const report = {
        forEach: (cb: (value: any, key: string) => void) => {
          statsMap.forEach((v, k) => cb(v, k));
        },
        get: (id: string) => statsMap.get(id),
      } as unknown as RTCStatsReport;

      const detection = detectCandidatePairRelay(report);
      expect(detection.status).toBe("direct");
      expect(detection.isRelayed).toBe(false);
      expect(detection.localCandidateType).toBe("host");
      expect(detection.remoteCandidateType).toBe("srflx");
    });

    it("detects relay connection when localCandidateType is relay", () => {
      const statsMap = new Map<string, any>();
      statsMap.set("transport-1", {
        type: "transport",
        selectedCandidatePairId: "pair-relay",
      });
      statsMap.set("pair-relay", {
        type: "candidate-pair",
        id: "pair-relay",
        state: "succeeded",
        localCandidateId: "cand-local-relay",
        remoteCandidateId: "cand-remote-srflx",
      });
      statsMap.set("cand-local-relay", {
        type: "local-candidate",
        id: "cand-local-relay",
        candidateType: "relay",
      });
      statsMap.set("cand-remote-srflx", {
        type: "remote-candidate",
        id: "cand-remote-srflx",
        candidateType: "srflx",
      });

      const report = {
        forEach: (cb: (value: any, key: string) => void) => {
          statsMap.forEach((v, k) => cb(v, k));
        },
        get: (id: string) => statsMap.get(id),
      } as unknown as RTCStatsReport;

      const detection = detectCandidatePairRelay(report);
      expect(detection.status).toBe("relay");
      expect(detection.isRelayed).toBe(true);
      expect(detection.localCandidateType).toBe("relay");
    });

    it("detects relay connection when remoteCandidateType is relay", () => {
      const statsMap = new Map<string, any>();
      statsMap.set("pair-relay-remote", {
        type: "candidate-pair",
        id: "pair-relay-remote",
        selected: true,
        localCandidateId: "cand-local-host",
        remoteCandidateId: "cand-remote-relay",
      });
      statsMap.set("cand-local-host", {
        type: "local-candidate",
        id: "cand-local-host",
        candidateType: "host",
      });
      statsMap.set("cand-remote-relay", {
        type: "remote-candidate",
        id: "cand-remote-relay",
        candidateType: "relay",
      });

      const report = {
        forEach: (cb: (value: any, key: string) => void) => {
          statsMap.forEach((v, k) => cb(v, k));
        },
        get: (id: string) => statsMap.get(id),
      } as unknown as RTCStatsReport;

      const detection = detectCandidatePairRelay(report);
      expect(detection.status).toBe("relay");
      expect(detection.isRelayed).toBe(true);
      expect(detection.remoteCandidateType).toBe("relay");
    });

    it("returns unknown when candidate pair is missing or candidates not resolved", () => {
      const report = {
        forEach: () => {},
        get: () => undefined,
      } as unknown as RTCStatsReport;

      const detection = detectCandidatePairRelay(report);
      expect(detection.status).toBe("unknown");
      expect(detection.isRelayed).toBe(false);
    });
  });

  describe("DataChannelRateLimiter", () => {
    let mockChannel: any;

    beforeEach(() => {
      jest.useFakeTimers();
      mockChannel = {
        readyState: "open",
        bufferedAmount: 0,
        bufferedAmountLowThreshold: 0,
        send: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      };
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("passes small messages immediately when disabled", () => {
      const limiter = new DataChannelRateLimiter();
      limiter.setEnabled(false);

      const sent = limiter.send(mockChannel, "hello direct mesh");
      expect(sent).toBe(true);
      expect(mockChannel.send).toHaveBeenCalledWith("hello direct mesh");
      expect(limiter.getQueueLength()).toBe(0);
    });

    it("respects token bucket burst up to RELAY_BURST_CAPACITY_BYTES and throttles subsequent messages", () => {
      const limiter = new DataChannelRateLimiter({
        bytesPerSecond: RELAY_BANDWIDTH_BUDGET_BYTES_PER_SEC, // 6000 B/s (48 kbps)
        burstCapacityBytes: RELAY_BURST_CAPACITY_BYTES, // 12000 B
      });
      limiter.setEnabled(true);

      // Send 10,000 bytes (within burst of 12,000)
      const chunk10k = "x".repeat(10000);
      const sent1 = limiter.send(mockChannel, chunk10k);
      expect(sent1).toBe(true);
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      // Send another 5,000 bytes (exceeds remaining 2,000 bytes tokens -> queued)
      const chunk5k = "y".repeat(5000);
      const sent2 = limiter.send(mockChannel, chunk5k);
      expect(sent2).toBe(true); // accepted into queue
      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(limiter.getQueueLength()).toBe(1);

      // Advance clock by 500ms -> regenerates 3000 tokens (now ~5000 tokens) -> flushes queued message
      jest.advanceTimersByTime(500);
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
      expect(mockChannel.send).toHaveBeenLastCalledWith(chunk5k);
      expect(limiter.getQueueLength()).toBe(0);

      limiter.destroy();
    });

    it("respects priority order (high before normal and low)", () => {
      const limiter = new DataChannelRateLimiter({
        bytesPerSecond: 1000,
        burstCapacityBytes: 1000,
      });
      limiter.setEnabled(true);

      // Consume initial burst
      limiter.send(mockChannel, "x".repeat(1000));
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      // Queue low, normal, and high messages
      limiter.send(mockChannel, "low-msg", { priority: "low" });
      limiter.send(mockChannel, "normal-msg", { priority: "normal" });
      limiter.send(mockChannel, "high-msg", { priority: "high" });

      expect(limiter.getQueueLength()).toBe(3);

      // Advance time by 1000ms -> tokens replenished, queue should drain high first
      jest.advanceTimersByTime(1000);
      expect(mockChannel.send).toHaveBeenNthCalledWith(2, "high-msg");
      expect(mockChannel.send).toHaveBeenNthCalledWith(3, "normal-msg");
      expect(mockChannel.send).toHaveBeenNthCalledWith(4, "low-msg");

      limiter.destroy();
    });

    it("coalesces messages sharing the same coalescingKey", () => {
      const limiter = new DataChannelRateLimiter({
        bytesPerSecond: 1000,
        burstCapacityBytes: 1000,
      });
      limiter.setEnabled(true);

      // Consume burst
      limiter.send(mockChannel, "x".repeat(1000));

      // Send 3 cursor updates with same coalescing key
      limiter.send(mockChannel, JSON.stringify({ x: 10, y: 10 }), {
        priority: "low",
        coalescingKey: "cursor-user-1",
      });
      limiter.send(mockChannel, JSON.stringify({ x: 20, y: 20 }), {
        priority: "low",
        coalescingKey: "cursor-user-1",
      });
      limiter.send(mockChannel, JSON.stringify({ x: 30, y: 30 }), {
        priority: "low",
        coalescingKey: "cursor-user-1",
      });

      // Queue length should be 1 due to coalescing
      expect(limiter.getQueueLength()).toBe(1);

      jest.advanceTimersByTime(1000);
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
      expect(mockChannel.send).toHaveBeenLastCalledWith(JSON.stringify({ x: 30, y: 30 }));

      limiter.destroy();
    });

    it("respects maxQueueSize and drops lowest priority messages when full", () => {
      const limiter = new DataChannelRateLimiter({
        bytesPerSecond: 1000,
        burstCapacityBytes: 1000,
        maxQueueSize: 2,
      });
      limiter.setEnabled(true);

      // Exhaust burst
      limiter.send(mockChannel, "x".repeat(1000));

      // Add two low priority items
      limiter.send(mockChannel, "low-1", { priority: "low" });
      limiter.send(mockChannel, "low-2", { priority: "low" });
      expect(limiter.getQueueLength()).toBe(2);

      // Now add a high priority item; lowest priority should be dropped to preserve bounds
      limiter.send(mockChannel, "high-1", { priority: "high" });
      expect(limiter.getQueueLength()).toBe(2);

      jest.advanceTimersByTime(1000);
      expect(mockChannel.send).toHaveBeenCalledWith("high-1");

      limiter.destroy();
    });

    it("pauses draining when bufferedAmount exceeds high watermark", () => {
      const limiter = new DataChannelRateLimiter({
        bytesPerSecond: 1000,
        burstCapacityBytes: 1000,
        maxBufferedAmountBytes: 500,
      });
      limiter.setEnabled(true);

      // Exhaust burst
      limiter.send(mockChannel, "x".repeat(1000));

      // Queue next item
      limiter.send(mockChannel, "queued-item");

      // Simulate channel backpressure (bufferedAmount > 500)
      mockChannel.bufferedAmount = 600;

      jest.advanceTimersByTime(1000);
      // Shouldn't send queued-item yet due to backpressure
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      // Backpressure clears
      mockChannel.bufferedAmount = 0;
      // Trigger bufferedamountlow listener
      const lowHandler = mockChannel.addEventListener.mock.calls.find(
        (c: any) => c[0] === "bufferedamountlow",
      )?.[1];
      expect(lowHandler).toBeDefined();
      lowHandler();

      expect(mockChannel.send).toHaveBeenCalledTimes(2);
      expect(mockChannel.send).toHaveBeenLastCalledWith("queued-item");

      limiter.destroy();
    });

    it("flushes queue immediately when limiter is disabled (switched back to direct)", () => {
      const limiter = new DataChannelRateLimiter({
        bytesPerSecond: 1000,
        burstCapacityBytes: 1000,
      });
      limiter.setEnabled(true);

      // Exhaust burst
      limiter.send(mockChannel, "x".repeat(1000));
      limiter.send(mockChannel, "pending-1");
      limiter.send(mockChannel, "pending-2");
      expect(limiter.getQueueLength()).toBe(2);

      // Re-enable / switch to direct P2P
      limiter.setEnabled(false);
      expect(mockChannel.send).toHaveBeenCalledWith("pending-1");
      expect(mockChannel.send).toHaveBeenCalledWith("pending-2");
      expect(limiter.getQueueLength()).toBe(0);

      limiter.destroy();
    });
  });

  describe("Audio and Whiteboard constants", () => {
    it("defines the specified bandwidth throttling constants", () => {
      expect(RELAY_BANDWIDTH_BUDGET_BYTES_PER_SEC).toBe(6000); // 48 kbps
      expect(RELAY_OPTIMIZED_AUDIO_BITRATE_BPS).toBe(24000); // 24 kbps
      expect(DIRECT_RESTORED_AUDIO_BITRATE_BPS).toBe(64000); // 64 kbps
      expect(RELAY_WHITEBOARD_THROTTLE_MS).toBe(250);
      expect(DIRECT_WHITEBOARD_THROTTLE_MS).toBe(33);
    });
  });
});
