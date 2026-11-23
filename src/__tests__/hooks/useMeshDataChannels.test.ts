import { renderHook, act } from "@testing-library/react";

import { useMeshDataChannels } from "@/hooks/useMeshDataChannels";

// Mock @clerk/nextjs
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: null,

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

let mockPartySocketOnMessage: ((event: { data: string }) => void) | null = null;
const mockSocketSend = jest.fn();

jest.mock("partysocket/react", () => {
  return jest.fn().mockImplementation((config) => {
    mockPartySocketOnMessage = config.onMessage;

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


class MockRTCDataChannel {
  public label: string;
  public readyState: string = "open";
  public onmessage: ((ev: { data: any }) => void) | null = null;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;

  constructor(label: string) {
    this.label = label;
  }

  send = jest.fn();
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
}

let latestDataChannel: MockRTCDataChannel | null = null;

class MockRTCPeerConnection {
  public onicecandidate: any = null;
  public ondatachannel: any = null;
  public oniceconnectionstatechange: any = null;
  public iceConnectionState: string = "connected";

  createDataChannel(label: string) {
    const dc = new MockRTCDataChannel(label);
    latestDataChannel = dc;
    return dc;
  }

  createOffer = jest.fn().mockResolvedValue({ type: "offer", sdp: "mock-sdp" });
  setLocalDescription = jest.fn().mockResolvedValue(undefined);
  setRemoteDescription = jest.fn().mockResolvedValue(undefined);
  createAnswer = jest
    .fn()
    .mockResolvedValue({ type: "answer", sdp: "mock-answer" });
  addIceCandidate = jest.fn().mockResolvedValue(undefined);
  close = jest.fn();
}

describe("useMeshDataChannels Hook Deduplication Integration", () => {
  let originalRTCPeerConnection: any;

  beforeAll(() => {
    originalRTCPeerConnection = global.RTCPeerConnection;
    (global as any).RTCPeerConnection = MockRTCPeerConnection;
  });

  afterAll(() => {
    (global as any).RTCPeerConnection = originalRTCPeerConnection;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    latestDataChannel = null;
  });

  it("intercepts duplicate binary messages and drops them before calling onData", () => {
    const onData = jest.fn();
    const { result } = renderHook(() =>
      useMeshDataChannels({
        roomId: "test-room",
        userId: "user-local-1",
        onData,
        enableDeduplication: true,
      }),
    );

    // Simulate incoming signal "peer-join" from peer-2
    act(() => {
      mockPartySocketOnMessage?.({
        data: JSON.stringify({
          type: "webrtc-signal",
          kind: "peer-join",
          from: "peer-2",
        }),
      });
    });

    expect(latestDataChannel).not.toBeNull();
    const dc = latestDataChannel!;

    // Open channel
    act(() => {
      dc.onopen?.();
    });

    const payloadA = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const payloadB = new Uint8Array([9, 8, 7, 6, 5]).buffer;

    // Send payloadA for the first time
    act(() => {
      dc.onmessage?.({ data: payloadA });
    });

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenLastCalledWith("peer-2", payloadA);
    expect(result.current.droppedDuplicates).toBe(0);

    // Send identical payloadA a second time (duplicate forwarding)
    act(() => {
      dc.onmessage?.({ data: payloadA });
    });

    // Must NOT call onData again
    expect(onData).toHaveBeenCalledTimes(1);
    expect(result.current.droppedDuplicates).toBe(1);

    // Send payloadB (new message)
    act(() => {
      dc.onmessage?.({ data: payloadB });
    });

    // Must deliver payloadB
    expect(onData).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenLastCalledWith("peer-2", payloadB);
    expect(result.current.droppedDuplicates).toBe(1);

    result.current.bloomFilter?.destroy();
  });

  it("allows duplicate payloads when enableDeduplication is false", () => {
    const onData = jest.fn();
    const { unmount } = renderHook(() =>
      useMeshDataChannels({
        roomId: "test-room",
        userId: "user-local-1",
        onData,
        enableDeduplication: false,
      }),
    );

    act(() => {
      mockPartySocketOnMessage?.({
        data: JSON.stringify({
          type: "webrtc-signal",
          kind: "peer-join",
          from: "peer-3",
        }),
      });
    });

    const dc = latestDataChannel!;
    act(() => {
      dc.onopen?.();
    });

    const payload = new Uint8Array([42, 42, 42]).buffer;

    act(() => {
      dc.onmessage?.({ data: payload });
    });
    expect(onData).toHaveBeenCalledTimes(1);

    act(() => {
      dc.onmessage?.({ data: payload });
    });
    // With deduplication disabled, duplicate is delivered
    expect(onData).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("suppresses echoes of locally broadcasted messages", () => {
    const onData = jest.fn();
    const { result, unmount } = renderHook(() =>
      useMeshDataChannels({
        roomId: "test-room",
        userId: "user-local-1",
        onData,
        enableDeduplication: true,
      }),
    );

    act(() => {
      mockPartySocketOnMessage?.({
        data: JSON.stringify({
          type: "webrtc-signal",
          kind: "peer-join",
          from: "peer-4",
        }),
      });
    });

    const dc = latestDataChannel!;
    act(() => {
      dc.onopen?.();
    });

    const localBroadcast = new Uint8Array([7, 14, 21, 28]).buffer;

    // Broadcast locally
    act(() => {
      result.current.sendToAll(localBroadcast);
    });

    // Remote peer relays/echoes our own message back to us
    act(() => {
      dc.onmessage?.({ data: localBroadcast });
    });

    // onData must NOT be called for our own echoed message
    expect(onData).toHaveBeenCalledTimes(0);
    expect(result.current.droppedDuplicates).toBe(1);

    unmount();
  });

  it("cleans up Bloom filter resources on hook unmount", () => {
    const { result, unmount } = renderHook(() =>
      useMeshDataChannels({
        roomId: "test-room",
        userId: "user-local-1",
      }),
    );

    const bloomFilter = result.current.bloomFilter;
    expect(bloomFilter).not.toBeNull();
    const destroySpy = jest.spyOn(bloomFilter!, "destroy");

    unmount();
    expect(destroySpy).toHaveBeenCalled();

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
