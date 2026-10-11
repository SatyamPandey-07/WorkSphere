import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpatialAudioPanner } from "@/core/audio/SpatialAudioPanner";

describe("SpatialAudioPanner Master Gain & Mute All (#5631)", () => {
  let mockAudioContext: any;
  let mockDestination: any;
  let mockMasterGain: any;
  let mockListener: any;

  beforeEach(() => {
    mockDestination = {};
    mockMasterGain = {
      gain: {
        value: 1.0,
        setValueAtTime: vi.fn((val: number) => {
          mockMasterGain.gain.value = val;
        }),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockListener = {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
    };

    mockAudioContext = {
      currentTime: 10,
      destination: mockDestination,
      listener: mockListener,
      createGain: vi.fn(() => mockMasterGain),
      createPanner: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createMediaStreamSource: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    };
  });

  it("initializes with master gain 1.0 and toggles master gain between 0.0 and 1.0", () => {
    const panner = new SpatialAudioPanner(mockAudioContext);

    expect(panner.getIsMuted()).toBe(false);
    expect(panner.getMasterGain()).toBe(1.0);

    // Mute all
    const muted = panner.toggleMuteAll();
    expect(muted).toBe(true);
    expect(panner.getIsMuted()).toBe(true);
    expect(mockMasterGain.gain.setValueAtTime).toHaveBeenCalledWith(0.0, 10);
    expect(panner.getMasterGain()).toBe(0.0);

    // Unmute all
    const unmuted = panner.toggleMuteAll();
    expect(unmuted).toBe(false);
    expect(panner.getIsMuted()).toBe(false);
    expect(mockMasterGain.gain.setValueAtTime).toHaveBeenCalledWith(1.0, 10);
    expect(panner.getMasterGain()).toBe(1.0);
  });

  it("sets master gain directly with clamping", () => {
    const panner = new SpatialAudioPanner(mockAudioContext);

    panner.setMasterGain(0.0);
    expect(panner.getIsMuted()).toBe(true);
    expect(panner.getMasterGain()).toBe(0.0);

    panner.setMasterGain(0.8);
    expect(panner.getIsMuted()).toBe(false);
    expect(panner.getMasterGain()).toBe(0.8);
  });
});
