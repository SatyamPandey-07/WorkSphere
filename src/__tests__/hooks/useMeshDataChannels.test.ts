import { renderHook, act } from "@testing-library/react";
import {
  useMeshDataChannels,
  classifyPeerQuality,
  type PeerTelemetry,
} from "@/hooks/useMeshDataChannels";

// Mock clerk useAuth
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

// Mock partysocket/react
const mockSocketSend = jest.fn();
let mockSocketOptions: any = null;

jest.mock("partysocket/react", () => {
  return jest.fn((options: any) => {
    mockSocketOptions = options;
    return {
      send: mockSocketSend,
      close: jest.fn(),
    };
  });
});

// Mock stateVectorChecksum
jest.mock("@/lib/crdt/stateVectorChecksum", () => ({
  resetStateVectorChecksumCache: jest.fn(),
}));

describe("useMeshDataChannels & classifyPeerQuality", () => {
  describe("classifyPeerQuality threshold rules", () => {
    it("returns 'unknown' when neither RTT nor packet loss is valid", () => {
      expect(classifyPeerQuality(null, null)).toBe("unknown");
      expect(classifyPeerQuality(undefined, undefined)).toBe("unknown");
      expect(classifyPeerQuality(NaN, NaN)).toBe("unknown");
      expect(classifyPeerQuality(-10, -5)).toBe("unknown");
    });

    it("returns 'good' when RTT < 100ms and loss < 1%", () => {
      expect(classifyPeerQuality(50, 0)).toBe("good");
      expect(classifyPeerQuality(99.9, 0.9)).toBe("good");
      expect(classifyPeerQuality(50, null)).toBe("good"); // Loss unavailable, good RTT
      expect(classifyPeerQuality(null, 0.5)).toBe("good"); // RTT unavailable, good Loss
    });

    it("returns 'fair' when 100ms <= RTT <= 250ms or 1% <= loss <= 5%", () => {
      // Exact boundaries
      expect(classifyPeerQuality(100, 0)).toBe("fair");
      expect(classifyPeerQuality(250, 0)).toBe("fair");
      expect(classifyPeerQuality(50, 1)).toBe("fair");
      expect(classifyPeerQuality(50, 5)).toBe("fair");
      expect(classifyPeerQuality(150, 3)).toBe("fair");
      expect(classifyPeerQuality(250, 5)).toBe("fair");
    });

    it("returns 'poor' when RTT > 250ms or loss > 5%", () => {
      expect(classifyPeerQuality(250.1, 0)).toBe("poor");
      expect(classifyPeerQuality(300, 0.5)).toBe("poor");
      expect(classifyPeerQuality(50, 5.1)).toBe("poor");
      expect(classifyPeerQuality(50, 10)).toBe("poor");
      expect(classifyPeerQuality(500, 15)).toBe("poor");
    });

    it("prioritizes 'poor' over 'fair'", () => {
      // RTT is poor (> 250), loss is fair (2%) => poor
      expect(classifyPeerQuality(300, 2)).toBe("poor");
      // RTT is fair (150ms), loss is poor (8%) => poor
      expect(classifyPeerQuality(150, 8)).toBe("poor");
    });
  });

  describe("Telemetry polling & stats parsing in useMeshDataChannels", () => {
    let originalRTCPeerConnection: any;

    beforeEach(() => {
      jest.useFakeTimers();
      mockSocketSend.mockClear();

      originalRTCPeerConnection = global.RTCPeerConnection;

      // Mock RTCPeerConnection
      (global as any).RTCPeerConnection = jest.fn().mockImplementation(() => {
        const pc: any = {
          signalingState: "stable",
          connectionState: "connected",
          iceConnectionState: "connected",
          onicecandidate: null,
          ondatachannel: null,
          oniceconnectionstatechange: null,
          close: jest.fn(() => {
            pc.signalingState = "closed";
            pc.connectionState = "closed";
          }),
          createOffer: jest
            .fn()
            .mockResolvedValue({ type: "offer", sdp: "offer-sdp" }),
          createAnswer: jest
            .fn()
            .mockResolvedValue({ type: "answer", sdp: "answer-sdp" }),
          setLocalDescription: jest.fn().mockResolvedValue(undefined),
          setRemoteDescription: jest.fn().mockResolvedValue(undefined),
          addIceCandidate: jest.fn().mockResolvedValue(undefined),
          createDataChannel: jest.fn().mockImplementation((label: string) => ({
            label,
            readyState: "open",
            send: jest.fn(),
            close: jest.fn(),
            onopen: null,
            onclose: null,
            onmessage: null,
          })),
          getStats: jest.fn().mockResolvedValue(new Map()),
        };
        return pc;
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      global.RTCPeerConnection = originalRTCPeerConnection;
    });

    it("initializes with empty peerTelemetry", async () => {
      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() =>
          useMeshDataChannels({
            roomId: "test-room",
            userId: "user-1",
          }),
        );
      });
      const { result } = hookResult;

      expect(result.current.peerTelemetry).toEqual({});
      expect(result.current.peerCount).toBe(0);
      expect(result.current.isConnected).toBe(false);
    });

    it("polls getStats and calculates RTT, bitrate, and packet loss correctly", async () => {
      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() =>
          useMeshDataChannels({
            roomId: "test-room",
            userId: "user-1",
          }),
        );
      });
      const { result } = hookResult;

      // Simulate a peer joining (triggering offer)
      await act(async () => {
        mockSocketOptions.onMessage({
          data: JSON.stringify({
            type: "webrtc-signal",
            kind: "peer-join",
            from: "peer-abc",
          }),
        });
      });

      // Get the created peer connection instance
      const pc = (global.RTCPeerConnection as jest.Mock).mock.results[0]?.value;
      expect(pc).toBeDefined();

      // Sample 1: Initial stats report
      const statsSample1 = [
        {
          type: "candidate-pair",
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.045, // 45 ms
          bytesSent: 1000,
          bytesReceived: 2000,
        },
        {
          type: "data-channel",
          bytesSent: 500,
          bytesReceived: 800,
        },
        {
          type: "inbound-rtp",
          packetsLost: 2,
          packetsReceived: 98,
        },
      ];

      pc.getStats.mockResolvedValue(statsSample1);

      // Advance timer by 3000ms to trigger pollStats
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      // After first sample: baseline is established, bitrateBps is null, RTT is 45ms, loss is calculated
      let telemetry: PeerTelemetry = result.current.peerTelemetry["peer-abc"];
      expect(telemetry).toBeDefined();
      expect(telemetry.peerId).toBe("peer-abc");
      expect(telemetry.rttMs).toBe(45);
      expect(telemetry.packetLossPercent).toBe(2); // 2 / (98 + 2) * 100 = 2.0%
      expect(telemetry.packetLossSource).toBe("inbound-rtp");
      expect(telemetry.bitrateBps).toBeNull(); // baseline sample
      expect(telemetry.quality).toBe("fair"); // 2% loss is fair (1% <= loss <= 5%)

      // Sample 2: 3 seconds later
      // Sent +1500 bytes (data-channel: 500 -> 2000)
      // Recv +3000 bytes (data-channel: 800 -> 3800)
      // RTT down to 30ms (0.030s)
      // Packets lost +0, packets received +100
      const statsSample2 = [
        {
          type: "candidate-pair",
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.03, // 30 ms
        },
        {
          type: "data-channel",
          bytesSent: 2000,
          bytesReceived: 3800,
        },
        {
          type: "inbound-rtp",
          packetsLost: 2, // no new loss
          packetsReceived: 198, // +100 received
        },
      ];

      pc.getStats.mockResolvedValue(statsSample2);

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      telemetry = result.current.peerTelemetry["peer-abc"];
      expect(telemetry.rttMs).toBe(30);
      // Bitrate calculation:
      // bytesSentDelta = 1500, elapsed = 3s -> (1500 * 8) / 3 = 4000 bps
      // bytesRecvDelta = 3000, elapsed = 3s -> (3000 * 8) / 3 = 8000 bps
      expect(telemetry.bitrateBps).toEqual({
        sent: 4000,
        received: 8000,
      });
      // Packet loss delta: lostDelta = 0, recvDelta = 100 -> 0% loss
      expect(telemetry.packetLossPercent).toBe(0);
      expect(telemetry.packetLossSource).toBe("inbound-rtp");
      expect(telemetry.quality).toBe("good"); // RTT 30ms (< 100), loss 0% (< 1%)
    });

    it("marks packet loss as 'unavailable' when only data channels are active with no RTP reports", async () => {
      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() =>
          useMeshDataChannels({
            roomId: "test-room",
            userId: "user-1",
          }),
        );
      });
      const { result } = hookResult;

      await act(async () => {
        mockSocketOptions.onMessage({
          data: JSON.stringify({
            type: "webrtc-signal",
            kind: "peer-join",
            from: "peer-pure-datachannel",
          }),
        });
      });

      const pc = (global.RTCPeerConnection as jest.Mock).mock.results[0]?.value;

      const pureDataChannelStats = [
        {
          type: "candidate-pair",
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.08, // 80 ms
          bytesSent: 400,
          bytesReceived: 600,
        },
        {
          type: "data-channel",
          bytesSent: 400,
          bytesReceived: 600,
        },
      ];

      pc.getStats.mockResolvedValue(pureDataChannelStats);

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      const telemetry = result.current.peerTelemetry["peer-pure-datachannel"];
      expect(telemetry).toBeDefined();
      expect(telemetry.rttMs).toBe(80);
      expect(telemetry.packetLossPercent).toBeNull();
      expect(telemetry.packetLossSource).toBe("unavailable");
      // Quality evaluated based on valid RTT alone (80ms < 100ms => good)
      expect(telemetry.quality).toBe("good");
    });

    it("handles byte counter resets without producing negative bitrates", async () => {
      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() =>
          useMeshDataChannels({
            roomId: "test-room",
            userId: "user-1",
          }),
        );
      });
      const { result } = hookResult;

      await act(async () => {
        mockSocketOptions.onMessage({
          data: JSON.stringify({
            type: "webrtc-signal",
            kind: "peer-join",
            from: "peer-reset",
          }),
        });
      });

      const pc = (global.RTCPeerConnection as jest.Mock).mock.results[0]?.value;

      // Sample 1
      pc.getStats.mockResolvedValue([
        {
          type: "candidate-pair",
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.12,
          bytesSent: 50000,
          bytesReceived: 50000,
        },
      ]);

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      // Sample 2: Counter reset (e.g. channel reconnect, lower values)
      pc.getStats.mockResolvedValue([
        {
          type: "candidate-pair",
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.12,
          bytesSent: 1000, // lower than 50000
          bytesReceived: 1000,
        },
      ]);

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      const telemetry = result.current.peerTelemetry["peer-reset"];
      expect(telemetry.bitrateBps?.sent).toBeGreaterThanOrEqual(0);
      expect(telemetry.bitrateBps?.received).toBeGreaterThanOrEqual(0);
    });

    it("cleans up telemetry state when a peer leaves", async () => {
      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() =>
          useMeshDataChannels({
            roomId: "test-room",
            userId: "user-1",
          }),
        );
      });
      const { result } = hookResult;

      await act(async () => {
        mockSocketOptions.onMessage({
          data: JSON.stringify({
            type: "webrtc-signal",
            kind: "peer-join",
            from: "peer-leaving",
          }),
        });
      });

      const pc = (global.RTCPeerConnection as jest.Mock).mock.results[0]?.value;
      pc.getStats.mockResolvedValue([
        {
          type: "candidate-pair",
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.05,
        },
      ]);

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      expect(result.current.peerTelemetry["peer-leaving"]).toBeDefined();

      // Peer leaves
      await act(async () => {
        mockSocketOptions.onMessage({
          data: JSON.stringify({
            type: "webrtc-signal",
            kind: "peer-leave",
            from: "peer-leaving",
          }),
        });
      });

      expect(result.current.peerTelemetry["peer-leaving"]).toBeUndefined();
    });

    it("clears polling interval on hook unmount", async () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      let unmountFn: any;
      await act(async () => {
        const { unmount } = renderHook(() =>
          useMeshDataChannels({
            roomId: "test-room",
            userId: "user-1",
          }),
        );
        unmountFn = unmount;
      });

      unmountFn();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
