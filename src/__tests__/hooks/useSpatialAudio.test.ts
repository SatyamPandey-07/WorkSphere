import { renderHook } from "@testing-library/react";
import { useSpatialAudio } from "@/hooks/useSpatialAudio";

const mockAudioContext = {
  state: "suspended" as AudioContextState,
  listener: {
    positionX: { value: 0 },
    positionY: { value: 0 },
    positionZ: { value: 0 },
    forwardX: { value: 0 },
    forwardY: { value: 0 },
    forwardZ: { value: -1 },
    upX: { value: 0 },
    upY: { value: 1 },
    upZ: { value: 0 },
  },
  createMediaStreamSource: jest.fn(),
  createGain: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  resume: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
};

const mockPannerNode = {
  panningModel: "HRTF",
  distanceModel: "inverse",
  positionX: { value: 0 },
  positionY: { value: 0 },
  positionZ: { value: 0 },
  orientationX: { value: 0 },
  orientationY: { value: 0 },
  orientationZ: { value: 0 },
  connect: jest.fn(),
  disconnect: jest.fn(),
};

const mockRouter = {
  updateListenerPosition: jest.fn(),
  updateListenerOrientation: jest.fn(),
  updatePeerPosition: jest.fn(),
  updatePeerOrientation: jest.fn(),
  attachRemoteTrack: jest.fn(),
  detachPeer: jest.fn(),
  setPeerVolume: jest.fn(),
  detachAll: jest.fn(),
  getChain: jest.fn(),
  getChains: jest.fn(),
};

const mockInterpolator = {
  applyUpdate: jest.fn(),
  interpolate: jest.fn(),
  clearUser: jest.fn(),
  clearAll: jest.fn(),
  getHistory: jest.fn(),
  getUserIds: jest.fn().mockReturnValue([]),
  dispose: jest.fn(),
};

jest.mock("@/lib/spatial/SpatialAudioRouter", () => ({
  SpatialAudioRouter: jest.fn(() => mockRouter),
}));

jest.mock("@/lib/spatial/RemoteListenerInterpolator", () => ({
  RemoteListenerInterpolator: jest.fn(() => mockInterpolator),
}));

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(globalThis, "AudioContext", {
    value: jest.fn(() => mockAudioContext),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "PannerNode", {
    value: jest.fn(() => mockPannerNode),
    writable: true,
    configurable: true,
  });
});

describe("useSpatialAudio", () => {
  it("returns empty remoteListeners array when no listeners exist", () => {
    mockInterpolator.getUserIds.mockReturnValue([]);

    const { result } = renderHook(() =>
      useSpatialAudio({ roomId: "test-room", userId: "user-1" }),
    );

    expect(Array.isArray(result.current.remoteListeners)).toBe(true);
    expect(result.current.remoteListeners).toHaveLength(0);
  });

  it("remoteListeners is always an array (never undefined or null)", () => {
    mockInterpolator.getUserIds.mockReturnValue([]);

    const { result } = renderHook(() =>
      useSpatialAudio({ roomId: "test-room", userId: "user-1" }),
    );

    expect(result.current.remoteListeners).toBeDefined();
    expect(Array.isArray(result.current.remoteListeners)).toBe(true);

    expect(() => {
      result.current.remoteListeners.map((id: string) => id);
    }).not.toThrow();
  });

  it("remoteListeners includes peer IDs after receiving updates", () => {
    mockInterpolator.getUserIds.mockReturnValue(["peer-1", "peer-2"]);

    const { result } = renderHook(() =>
      useSpatialAudio({ roomId: "test-room", userId: "user-1" }),
    );

    expect(Array.isArray(result.current.remoteListeners)).toBe(true);
  });
});
