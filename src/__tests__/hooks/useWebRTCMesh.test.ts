import { renderHook, act } from "@testing-library/react";
import { useWebRTCMesh } from "@/hooks/useWebRTCMesh";
import { adaptVideoBitrate } from "@/lib/screenShareBitrate";

// Mock Clerk
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

// Mock PartySocket
let mockSocketOnMessage: (event: any) => void;
const mockSocketSend = jest.fn();

jest.mock("partysocket/react", () => {
  return function usePartySocket(options: any) {
    mockSocketOnMessage = options.onMessage;
    return {
      send: mockSocketSend,
      close: jest.fn(),
    };
  };
});

// Mock lib/screenShareBitrate
jest.mock("@/lib/screenShareBitrate", () => ({
  adaptVideoBitrate: jest.fn(),
}));

// Mock navigator.mediaDevices
const mockApplyConstraints = jest.fn().mockResolvedValue(undefined);
const mockAudioTrack = {
  kind: "audio",
  enabled: true,
  applyConstraints: mockApplyConstraints,
  stop: jest.fn(),
};

const mockMediaStream = {
  getAudioTracks: () => [mockAudioTrack],
  getVideoTracks: () => [],
  getTracks: () => [mockAudioTrack],
};

Object.defineProperty(global.navigator, "mediaDevices", {
  value: {
    getUserMedia: jest.fn().mockResolvedValue(mockMediaStream),
    getDisplayMedia: jest.fn(),
  },
  writable: true,
});

// Mock window.AudioContext
const mockDisconnect = jest.fn();
class MockAudioContext {
  state = "running";
  createMediaStreamSource = jest.fn().mockReturnValue({
    connect: jest.fn(),
    disconnect: mockDisconnect,
  });
  createAnalyser = jest.fn().mockReturnValue({
    fftSize: 256,
    frequencyBinCount: 128,
    getByteFrequencyData: jest.fn(),
    getFloatTimeDomainData: jest.fn((array: Float32Array) => {
      array.fill(0);
    }),
    disconnect: mockDisconnect,
  });
  close = jest.fn();
  resume = jest.fn().mockResolvedValue(undefined);
}
(global as any).AudioContext = MockAudioContext;
(global as any).webkitAudioContext = MockAudioContext;

class MockRTCPeerConnection {
  onicecandidate: any = null;
  ontrack: any = null;
  oniceconnectionstatechange: any = null;
  onnegotiationneeded: any = null;
  iceConnectionState = "connected";
  signalingState = "stable";

  getSenders = jest.fn().mockReturnValue([]);
  getStats = jest.fn().mockResolvedValue(new Map());
  addTrack = jest.fn();
  close = jest.fn();
  setLocalDescription = jest.fn().mockResolvedValue(undefined);
  setRemoteDescription = jest.fn().mockResolvedValue(undefined);
  createOffer = jest.fn().mockResolvedValue({ type: "offer", sdp: "sdp" });
  createAnswer = jest.fn().mockResolvedValue({ type: "answer", sdp: "sdp" });
  addIceCandidate = jest.fn().mockResolvedValue(undefined);
}
(global as any).RTCPeerConnection = MockRTCPeerConnection;

describe("useWebRTCMesh Bandwidth Probing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sends ping telemetry and updates network quality based on RTT", async () => {
    const { result } = renderHook(() =>
      useWebRTCMesh({ roomId: "test-room", userId: "user-1" }),
    );

    // Needs to toggle audio to ensure local stream is created
    await act(async () => {
      await result.current.toggleAudio();
    });

    // Initial state
    expect(result.current.networkQuality).toBe("unknown");
    expect(result.current.rtt).toBe(0);

    // Fast-forward to trigger ping setInterval (2000ms)
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Expect send to be called with ping
    expect(mockSocketSend).toHaveBeenCalled();
    const lastSendCall =
      mockSocketSend.mock.calls[mockSocketSend.mock.calls.length - 1][0];
    expect(JSON.parse(lastSendCall).type).toBe("ping");
    const pingTimestamp = JSON.parse(lastSendCall).timestamp;

    // Simulate pong response after 350ms (Poor network)
    act(() => {
      jest.setSystemTime(pingTimestamp + 350);
      mockSocketOnMessage({
        data: JSON.stringify({ type: "pong", timestamp: pingTimestamp }),
      });
    });

    // React state updates
    expect(result.current.rtt).toBe(350);
    expect(result.current.networkQuality).toBe("poor");

    // When network is poor, it should apply downsample constraint
    expect(mockApplyConstraints).toHaveBeenCalledWith({ sampleRate: 16000 });

    // Simulate recovery to good network (50ms RTT)
    // We need to send a few pongs to bring EMA down
    for (let i = 0; i < 5; i++) {
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      const pingTime = Date.now();

      act(() => {
        jest.setSystemTime(pingTime + 20); // very fast now
        mockSocketOnMessage({
          data: JSON.stringify({ type: "pong", timestamp: pingTime }),
        });
      });
    }

    // Now it should be good
    expect(result.current.networkQuality).toBe("good");
    expect(mockApplyConstraints).toHaveBeenCalledWith({ sampleRate: 48000 });
  });

  it("periodically triggers adaptVideoBitrate and handles low quality transport tiers", async () => {
    (adaptVideoBitrate as jest.Mock).mockResolvedValue({
      maxBitrate: 400_000,
      audioMaxBitrate: 16_000,
      label: "low",
    });

    const { result } = renderHook(() =>
      useWebRTCMesh({ roomId: "test-room", userId: "user-1" }),
    );

    await act(async () => {
      await result.current.toggleAudio();
    });

    // Simulate remote peer joining
    act(() => {
      mockSocketOnMessage({
        data: JSON.stringify({
          type: "webrtc-signal",
          kind: "peer-join",
          from: "user-2",
        }),
      });
    });

    // Advance 4000ms to trigger bitrate timer
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });

    // Expect network quality to transition to poor when transport tier is low
    expect(result.current.networkQuality).toBe("poor");
    expect(mockApplyConstraints).toHaveBeenCalledWith({ sampleRate: 16000 });
  });
});

describe("useWebRTCMesh Audio Level EMA Smoothing & Node Cleanup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("smooths decibel readings using EMA (alpha = 0.2) and cleans up audio nodes on unmount", async () => {
    let floatDataFn: ((arr: Float32Array) => void) | null = null;
    const localDisconnect = jest.fn();

    (global as any).AudioContext = class extends MockAudioContext {
      createMediaStreamSource = jest.fn().mockReturnValue({
        connect: jest.fn(),
        disconnect: localDisconnect,
      });
      createAnalyser = jest.fn().mockReturnValue({
        fftSize: 256,
        frequencyBinCount: 128,
        getFloatTimeDomainData: jest.fn((arr: Float32Array) => {
          if (floatDataFn) floatDataFn(arr);
          else arr.fill(0);
        }),
        disconnect: localDisconnect,
      });
    };

    const { result, unmount } = renderHook(() =>
      useWebRTCMesh({ roomId: "test-room", userId: "user-1" }),
    );

    await act(async () => {
      await result.current.toggleAudio();
    });

    // Provide non-zero PCM samples (rms ~0.1 -> ~80 dB -> rawLevel ~0.833)
    floatDataFn = (arr: Float32Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = 0.1 * Math.sin((i * 2 * Math.PI) / 10);
      }
    };

    // Advance rAF / timers
    act(() => {
      jest.advanceTimersByTime(50);
    });

    // Audio level for 'local' should be smoothed (non-zero)
    const level1 = result.current.audioLevels["local"];
    expect(level1).toBeGreaterThan(0);

    // Unmount hook
    unmount();

    // Verify audio nodes were disconnected on unmount
    expect(localDisconnect).toHaveBeenCalled();
  });
});
