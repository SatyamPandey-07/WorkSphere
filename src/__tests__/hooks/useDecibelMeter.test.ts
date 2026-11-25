import { renderHook, act } from "@testing-library/react";
import {
  useDecibelMeter,
  calculateSafeRMS,
  computeSafeDecibels,
} from "@/hooks/useDecibelMeter";

describe("useDecibelMeter & safe decibel calculation (Issue #9361)", () => {
  let mockGetFloatTimeDomainData: jest.Mock;
  let mockAudioContextInstance: any;
  let mockGetUserMedia: jest.Mock;
  let mockTrackStop: jest.Mock;
  let originalAudioContext: any;
  let originalWebkitAudioContext: any;
  let originalMediaDevices: any;
  let _requestAnimationFrameSpy: jest.SpyInstance;
  let cancelAnimationFrameSpy: jest.SpyInstance;
  let animationFrameCallbacks: Array<(timestamp: number) => void>;

  beforeEach(() => {
    animationFrameCallbacks = [];
    _requestAnimationFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        animationFrameCallbacks.push(cb);
        return animationFrameCallbacks.length;
      });

    cancelAnimationFrameSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});

    mockTrackStop = jest.fn();
    mockGetUserMedia = jest.fn().mockResolvedValue({
      getTracks: () => [{ stop: mockTrackStop }],
    });

    originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: mockGetUserMedia,
      },
      writable: true,
      configurable: true,
    });

    mockGetFloatTimeDomainData = jest.fn((array: Float32Array) => {
      array.fill(0);
    });

    mockAudioContextInstance = {
      createMediaStreamSource: jest.fn().mockReturnValue({
        connect: jest.fn(),
      }),
      createAnalyser: jest.fn().mockReturnValue({
        fftSize: 2048,
        getFloatTimeDomainData: mockGetFloatTimeDomainData,
      }),
      close: jest.fn().mockResolvedValue(undefined),
      state: "running",
    };

    originalAudioContext = (window as any).AudioContext;
    originalWebkitAudioContext = (window as any).webkitAudioContext;

    const MockAudioContext = jest.fn(() => mockAudioContextInstance);
    (window as any).AudioContext = MockAudioContext;
    (window as any).webkitAudioContext = MockAudioContext;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (window as any).AudioContext = originalAudioContext;
    (window as any).webkitAudioContext = originalWebkitAudioContext;
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      writable: true,
      configurable: true,
    });
  });

  // Helper to trigger one animation frame step
  const triggerAnimationFrame = (now: number) => {
    const callbacks = [...animationFrameCallbacks];
    animationFrameCallbacks = [];
    callbacks.forEach((cb) => cb(now));
  };

  describe("Unit tests: calculateSafeRMS", () => {
    test("handles empty and zero-length sample buffers safely", () => {
      expect(calculateSafeRMS(new Float32Array([]))).toBe(0);
      expect(calculateSafeRMS(null as any)).toBe(0);
      expect(calculateSafeRMS(undefined as any)).toBe(0);
    });

    test("handles all-zero silence samples returning 0", () => {
      const silence = new Float32Array(2048).fill(0);
      const rms = calculateSafeRMS(silence);
      expect(rms).toBe(0);
    });

    test("computes accurate RMS for normal sine audio samples", () => {
      const samples = new Float32Array(1000);
      const amplitude = 0.5;
      for (let i = 0; i < samples.length; i++) {
        samples[i] = amplitude * Math.sin((i * 2 * Math.PI) / 100);
      }
      const rms = calculateSafeRMS(samples);
      expect(rms).toBeGreaterThan(0.34);
      expect(rms).toBeLessThan(0.36);
    });

    test("safely ignores NaN and non-finite samples without propagating NaN", () => {
      const dirtySamples = new Float32Array([0.2, NaN, 0.2, Infinity, -Infinity, 0.2]);
      const rms = calculateSafeRMS(dirtySamples);
      expect(Number.isFinite(rms)).toBe(true);
      expect(rms).toBeCloseTo(0.2, 5);
    });

    test("returns 0 if all samples are NaN or Infinity", () => {
      const corrupted = new Float32Array([NaN, Infinity, -Infinity]);
      expect(calculateSafeRMS(corrupted)).toBe(0);
    });
  });

  describe("Unit tests: computeSafeDecibels", () => {
    test("silence and zero RMS produce 0 dB (never -Infinity or negative)", () => {
      const dbZero = computeSafeDecibels(0);
      expect(dbZero).toBe(0);
      expect(Number.isFinite(dbZero)).toBe(true);
      expect(dbZero).not.toBe(-Infinity);

      const dbNegative = computeSafeDecibels(-1);
      expect(dbNegative).toBe(0);
    });

    test("invalid and non-finite RMS values safely return 0 dB", () => {
      expect(computeSafeDecibels(NaN)).toBe(0);
      expect(computeSafeDecibels(Infinity)).toBe(0);
      expect(computeSafeDecibels(-Infinity)).toBe(0);
    });

    test("small RMS values (below 1.0) clamp to non-negative 0 dB floor", () => {
      // 20 * Math.log10(1e-5) = -100 dB -> clamps to 0
      expect(computeSafeDecibels(1e-5)).toBe(0);
      // 20 * Math.log10(0.01) = -40 dB -> clamps to 0
      expect(computeSafeDecibels(0.01)).toBe(0);
      // 20 * Math.log10(0.5) = -6.02 dB -> clamps to 0
      expect(computeSafeDecibels(0.5)).toBe(0);
    });

    test("normal speech/moderate amplitudes produce finite readings in [0, 120] dB", () => {
      // RMS of 10.0 -> 20 * Math.log10(10) = 20 dB
      const db10 = computeSafeDecibels(10);
      expect(db10).toBeCloseTo(20, 2);
      expect(db10).toBeGreaterThanOrEqual(0);
      expect(db10).toBeLessThanOrEqual(120);

      // RMS of 1000.0 -> 20 * Math.log10(1000) = 60 dB
      const db1000 = computeSafeDecibels(1000);
      expect(db1000).toBeCloseTo(60, 2);
      expect(db1000).toBeGreaterThanOrEqual(0);
      expect(db1000).toBeLessThanOrEqual(120);
    });

    test("extreme and clipped audio is strictly clamped to 120 dB ceiling", () => {
      // Extreme RMS of 10,000,000 -> 20 * Math.log10(10^7) = 140 dB -> clamps to 120 dB
      const dbHigh = computeSafeDecibels(10_000_000);
      expect(dbHigh).toBe(120);

      // 10^8 -> 160 dB -> clamps to 120 dB
      expect(computeSafeDecibels(1e8)).toBe(120);
    });
  });

  describe("Hook integration: useDecibelMeter", () => {
    test("initializes with null decibel reading and idle measuring state", () => {
      const { result } = renderHook(() => useDecibelMeter());

      expect(result.current.decibel).toBeNull();
      expect(result.current.isMeasuring).toBe(false);
      expect(result.current.error).toBeNull();
    });

    test("silence: an all-zero buffer produces decibel reading of 0 and satisfies output invariants", async () => {
      mockGetFloatTimeDomainData.mockImplementation((array: Float32Array) => {
        array.fill(0);
      });

      const { result } = renderHook(() => useDecibelMeter());

      await act(async () => {
        await result.current.start();
      });

      expect(result.current.isMeasuring).toBe(true);

      // Trigger one audio frame tick
      act(() => {
        triggerAnimationFrame(Date.now() + 100);
      });

      const decibels = result.current.decibel;
      expect(decibels).not.toBeNull();
      expect(decibels).toBe(0);
      expect(Number.isFinite(decibels!)).toBe(true);
      expect(decibels!).toBeGreaterThanOrEqual(0);
      expect(decibels!).toBeLessThanOrEqual(120);
    });

    test("repeated silent frames do not introduce negative or invalid state", async () => {
      mockGetFloatTimeDomainData.mockImplementation((array: Float32Array) => {
        array.fill(0);
      });

      const { result } = renderHook(() => useDecibelMeter());

      await act(async () => {
        await result.current.start();
      });

      // Simulate 5 consecutive silent frames
      for (let i = 1; i <= 5; i++) {
        act(() => {
          triggerAnimationFrame(Date.now() + i * 50);
        });
        expect(result.current.decibel).toBe(0);
        expect(Number.isFinite(result.current.decibel!)).toBe(true);
      }
    });

    test("normal speech/audio produces finite reading within [0, 120] dB", async () => {
      // Simulate normal microphone signal (e.g., RMS ~ 1000 -> 60 dB)
      mockGetFloatTimeDomainData.mockImplementation((array: Float32Array) => {
        array.fill(1000);
      });

      const { result } = renderHook(() => useDecibelMeter());

      await act(async () => {
        await result.current.start();
      });

      act(() => {
        triggerAnimationFrame(Date.now() + 100);
      });

      const decibels = result.current.decibel;
      expect(decibels).not.toBeNull();
      expect(Number.isFinite(decibels!)).toBe(true);
      expect(decibels!).toBeCloseTo(60, 1);
      expect(decibels!).toBeGreaterThanOrEqual(0);
      expect(decibels!).toBeLessThanOrEqual(120);
    });

    test("extreme and clipped audio signals are clamped to <= 120 dB without crashing", async () => {
      // Extremely loud or clipped sample (amplitude 1,000,000 -> 120 dB)
      mockGetFloatTimeDomainData.mockImplementation((array: Float32Array) => {
        array.fill(1_000_000);
      });

      const { result } = renderHook(() => useDecibelMeter());

      await act(async () => {
        await result.current.start();
      });

      act(() => {
        triggerAnimationFrame(Date.now() + 100);
      });

      const decibels = result.current.decibel;
      expect(decibels).toBe(120);
      expect(Number.isFinite(decibels!)).toBe(true);
      expect(decibels!).toBeGreaterThanOrEqual(0);
      expect(decibels!).toBeLessThanOrEqual(120);
    });

    test("invalid/corrupted audio samples (NaN, Infinity) fallback to 0 dB without throwing", async () => {
      mockGetFloatTimeDomainData.mockImplementation((array: Float32Array) => {
        for (let i = 0; i < array.length; i++) {
          array[i] = i % 2 === 0 ? NaN : Infinity;
        }
      });

      const { result } = renderHook(() => useDecibelMeter());

      await act(async () => {
        await result.current.start();
      });

      act(() => {
        triggerAnimationFrame(Date.now() + 100);
      });

      const decibels = result.current.decibel;
      expect(decibels).toBe(0);
      expect(Number.isFinite(decibels!)).toBe(true);
    });

    test("5-second measurement period calculates average and automatically stops", async () => {
      mockGetFloatTimeDomainData.mockImplementation((array: Float32Array) => {
        array.fill(100); // 20 * Math.log10(100) = 40 dB
      });

      const startTime = 1000000;
      jest.spyOn(Date, "now").mockReturnValue(startTime);

      const { result } = renderHook(() => useDecibelMeter());

      await act(async () => {
        await result.current.start();
      });

      // Frame 1 at 1 second
      jest.spyOn(Date, "now").mockReturnValue(startTime + 1000);
      act(() => {
        triggerAnimationFrame(startTime + 1000);
      });
      expect(result.current.decibel).toBe(40);
      expect(result.current.isMeasuring).toBe(true);

      // Frame 2 at 5.5 seconds (exceeding 5000ms threshold)
      jest.spyOn(Date, "now").mockReturnValue(startTime + 5500);
      act(() => {
        triggerAnimationFrame(startTime + 5500);
      });

      expect(result.current.decibel).toBe(40);
      expect(result.current.isMeasuring).toBe(false);
      expect(mockTrackStop).toHaveBeenCalled();
    });

    test("cleanup stops tracks and closes audio context on unmount", async () => {
      const { result, unmount } = renderHook(() => useDecibelMeter());

      await act(async () => {
        await result.current.start();
      });

      expect(result.current.isMeasuring).toBe(true);

      unmount();

      expect(mockTrackStop).toHaveBeenCalled();
      expect(mockAudioContextInstance.close).toHaveBeenCalled();
      expect(cancelAnimationFrameSpy).toHaveBeenCalled();
    });
  });
});
