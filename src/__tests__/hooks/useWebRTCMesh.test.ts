import { renderHook, act } from "@testing-library/react";
import { useWebRTCMesh } from "@/hooks/useWebRTCMesh";

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
class MockAudioContext {
  state = "running";
  createMediaStreamSource = jest.fn().mockReturnValue({ connect: jest.fn() });
  createAnalyser = jest.fn().mockReturnValue({
    fftSize: 256,
    frequencyBinCount: 128,
    getByteFrequencyData: jest.fn(),
  });
  close = jest.fn();
  resume = jest.fn().mockResolvedValue(undefined);
}
(global as any).AudioContext = MockAudioContext;
(global as any).webkitAudioContext = MockAudioContext;

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
      useWebRTCMesh({ roomId: "test-room", userId: "user-1" })
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
    const lastSendCall = mockSocketSend.mock.calls[mockSocketSend.mock.calls.length - 1][0];
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
});
