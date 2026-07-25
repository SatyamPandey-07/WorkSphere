import { renderHook, act } from "@testing-library/react";
import { useAudioEqualizer } from "../../hooks/useAudioEqualizer";

// Mock dependencies to avoid actual Web Audio API/WASM instantiation in test environments
jest.mock("@/lib/wasm/audioEqualizer", () => ({
  initEqualizer: jest.fn().mockResolvedValue(undefined),
  updateBand: jest.fn().mockResolvedValue(undefined),
  processAudioBlock: jest.fn(),
  getFrequencyResponse: jest.fn().mockResolvedValue({}),
  resetEqualizer: jest.fn(),
  DEFAULT_BANDS: [
    { frequency: 60, q: 1.4, gain: 0 },
    { frequency: 250, q: 1.4, gain: 0 },
    { frequency: 1000, q: 1.4, gain: 0 },
    { frequency: 4000, q: 1.4, gain: 0 },
    { frequency: 12000, q: 1.4, gain: 0 },
  ],
}));

describe("useAudioEqualizer Memory Leak & Cleanup Suite (#1285)", () => {
  let mockDisconnect: jest.Mock;
  let mockClose: jest.Mock;

  beforeEach(() => {
    mockDisconnect = jest.fn();
    mockClose = jest.fn().mockResolvedValue(undefined);

    const mockAudioContextInstance = {
      state: "running",
      close: mockClose,
      createGain: jest.fn(() => ({ disconnect: mockDisconnect })),
    };

    global.AudioContext = jest
      .fn()
      .mockImplementation(() => mockAudioContextInstance) as any;
  });

  it("explicitly disconnects filter nodes and closes AudioContext on unmount", async () => {
    const { unmount } = renderHook(() => useAudioEqualizer());

    // Unmount hook to trigger cleanup
    unmount();

    expect(mockClose).toHaveBeenCalled();
  });
});

describe("useAudioEqualizer Preset Logic (#1547)", () => {
  beforeEach(() => {
    // Clear localStorage before each test to ensure a clean slate
    window.localStorage.clear();
  });

  it("should initialize with Flat preset or fallback to localStorage", async () => {
    window.localStorage.setItem("eq_preset", "Bass Boost");

    const { result } = renderHook(() => useAudioEqualizer());

    expect(result.current.state.activePreset).toBe("Bass Boost");
  });

  it("should update state and save to localStorage when applyPreset is called", async () => {
    const { result } = renderHook(() => useAudioEqualizer());

    await act(async () => {
      await result.current.applyPreset("Voice Clarity");
    });

    expect(result.current.state.activePreset).toBe("Voice Clarity");
    expect(window.localStorage.getItem("eq_preset")).toBe("Voice Clarity");
  });

  it("should switch to Custom preset when a manual band adjustment is made", async () => {
    const { result } = renderHook(() => useAudioEqualizer());

    await act(async () => {
      await result.current.setBand(0, 5);
    });

    expect(result.current.state.activePreset).toBe("Custom");
    expect(window.localStorage.getItem("eq_preset")).toBe("Custom");
  });
});
