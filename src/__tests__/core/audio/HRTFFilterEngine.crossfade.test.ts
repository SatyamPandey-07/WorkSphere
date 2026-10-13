import { describe, it, expect, beforeEach, vi } from "vitest";
import { HRTFFilterEngine } from "@/core/audio/HRTFFilterEngine";

describe("HRTFFilterEngine Dual-Convolver Ping-Pong & Equal-Power Cross-Fade (#5607)", () => {
  let mockAudioContext: any;
  let mockGainA: any;
  let mockGainB: any;

  beforeEach(() => {
    mockGainA = {
      gain: {
        value: 1.0,
        setValueAtTime: vi.fn((val: number) => {
          mockGainA.gain.value = val;
        }),
        setValueCurveAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockGainB = {
      gain: {
        value: 0.0,
        setValueAtTime: vi.fn((val: number) => {
          mockGainB.gain.value = val;
        }),
        setValueCurveAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    let gainCallCount = 0;
    mockAudioContext = {
      currentTime: 10.0,
      sampleRate: 48000,
      createGain: vi.fn(() => {
        gainCallCount++;
        return gainCallCount % 2 === 1 ? mockGainA : mockGainB;
      }),
      createConvolver: vi.fn(() => ({
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createBuffer: vi.fn((channels, length, sampleRate) => ({
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: vi.fn(() => new Float32Array(length)),
      })),
    };
  });

  it("calculates equal-power cross-fade gains satisfying cos^2(t) + sin^2(t) ≈ 1.0", () => {
    const engine = new HRTFFilterEngine(mockAudioContext);

    for (let progress = 0; progress <= 1.0; progress += 0.1) {
      const { gainA, gainB } = engine.calculateEqualPowerGains(progress);
      const totalPower = gainA * gainA + gainB * gainB;
      expect(totalPower).toBeCloseTo(1.0, 5);
    }
  });

  it("smoothly transitions yaw orientation via dual-convolver ping-pong without audio discontinuities", () => {
    const engine = new HRTFFilterEngine(mockAudioContext);
    const mockBuffer1 = mockAudioContext.createBuffer(2, 512, 48000);
    const mockBuffer2 = mockAudioContext.createBuffer(2, 512, 48000);

    expect(engine.getActiveConvolver()).toBe("A");

    // Rapid yaw turn 90 degrees
    engine.transitionYaw(90, mockBuffer1, 15);
    expect(engine.getActiveConvolver()).toBe("B");
    expect(mockGainA.gain.setValueCurveAtTime).toHaveBeenCalled();
    expect(mockGainB.gain.setValueCurveAtTime).toHaveBeenCalled();

    // Another rapid turn 180 degrees -> ping-pongs back to A
    engine.transitionYaw(180, mockBuffer2, 15);
    expect(engine.getActiveConvolver()).toBe("A");
  });
});
