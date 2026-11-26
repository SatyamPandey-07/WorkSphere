import { renderHook, act } from "@testing-library/react";
import { useAvionicsAudio } from "@/hooks/useAvionicsAudio";
import { WASM_SIMD_PROBE_BYTES } from "@/lib/audio/spectralFallback";

jest.mock("@/hooks/useBatteryStatus", () => ({
  useBatteryStatus: () => ({ isSupported: false, charging: false, level: null }),
}));

const FFT = 512;
const HALF = FFT / 2;

type Port = {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage: jest.Mock;
};

function makeAnalyser(peakBin: number, peakDb: number) {
  return {
    fftSize: 0,
    smoothingTimeConstant: 0.8,
    frequencyBinCount: HALF,
    connect: jest.fn(),
    disconnect: jest.fn(),
    getFloatFrequencyData: jest.fn((arr: Float32Array) => {
      arr.fill(-120);
      arr[peakBin] = peakDb;
    }),
    getFloatTimeDomainData: jest.fn((arr: Float32Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = 0.25 * Math.sin((i * peakBin * 2 * Math.PI) / arr.length);
    }),
  };
}

const source = { connect: jest.fn(), disconnect: jest.fn() };
const stopTrack = jest.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;

let analyser = makeAnalyser(40, -20);
let workletPort: Port;

const ctx = {
  state: "running",
  sampleRate: 48000,
  currentTime: 0,
  destination: {},
  resume: jest.fn().mockResolvedValue(undefined),
  audioWorklet: { addModule: jest.fn() } as { addModule: jest.Mock } | undefined,
  createAnalyser: jest.fn(() => analyser),
  createMediaStreamSource: jest.fn(() => source),
};

class FakeAudioContext {
  constructor() {
    return ctx as unknown as FakeAudioContext;
  }
}

class FakeAudioWorkletNode {
  port: Port = { onmessage: null, postMessage: jest.fn() };
  connect = jest.fn();
  disconnect = jest.fn();
  constructor() {
    workletPort = this.port;
  }
}

const realValidate = WebAssembly.validate;
const setSimd = (supported: boolean) => {
  WebAssembly.validate = jest.fn((bytes: BufferSource) =>
    bytes === WASM_SIMD_PROBE_BYTES ? supported : realValidate(bytes),
  ) as typeof WebAssembly.validate;
};

describe("useAvionicsAudio analyzer SIMD detection and fallback (#8629)", () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeAll(() => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(globalThis, "AudioWorkletNode", {
      configurable: true,
      writable: true,
      value: FakeAudioWorkletNode,
    });
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    analyser = makeAnalyser(40, -20);
    ctx.audioWorklet = { addModule: jest.fn().mockResolvedValue(undefined) };
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    WebAssembly.validate = realValidate;
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const start = async (hook: ReturnType<typeof renderHook<ReturnType<typeof useAvionicsAudio>, unknown>>) => {
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.startFrequencyAnalyzer(stream);
    });
    return ok;
  };

  describe("SIMD-enabled environment", () => {
    beforeEach(() => setSimd(true));

    it("uses the WASM SIMD AudioWorklet and never touches AnalyserNode", async () => {
      const hook = renderHook(() => useAvionicsAudio());

      expect(await start(hook)).toBe(true);

      expect(ctx.audioWorklet!.addModule).toHaveBeenCalledWith("/worklets/fft-processor.js");
      expect(globalThis.fetch).toHaveBeenCalledWith("/wasm/fft_analyzer.wasm");
      expect(ctx.createAnalyser).not.toHaveBeenCalled();
      expect(hook.result.current.analyzerMode).toBe("wasm-simd");
      expect(hook.result.current.isAnalyzerActive).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("publishes worklet frames to the shared spectral state", async () => {
      const hook = renderHook(() => useAvionicsAudio());
      await start(hook);

      const bins = new Float32Array(HALF);
      bins[12] = 0.3;
      act(() => {
        workletPort.onmessage?.({
          data: {
            type: "SPECTRAL_FRAME",
            bins,
            splDb: 71,
            dominantFrequencyHz: 1125,
            latencyMs: 1.2,
          },
        });
      });

      expect(hook.result.current.spectralBins).toBe(bins);
      expect(hook.result.current.splDb).toBe(71);
      expect(hook.result.current.dominantFrequencyHz).toBe(1125);
      expect(hook.result.current.analyzerLatencyMs).toBe(1.2);
    });

    it("falls back to AnalyserNode when the WASM analyzer fails to load", async () => {
      ctx.audioWorklet = { addModule: jest.fn().mockRejectedValue(new Error("CSP blocked")) };
      const hook = renderHook(() => useAvionicsAudio());

      expect(await start(hook)).toBe(true);

      expect(ctx.createAnalyser).toHaveBeenCalled();
      expect(hook.result.current.analyzerMode).toBe("fallback");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("failed to load"));
    });

    it("falls back to AnalyserNode when AudioWorklet is unavailable", async () => {
      ctx.audioWorklet = undefined;
      const hook = renderHook(() => useAvionicsAudio());

      expect(await start(hook)).toBe(true);

      expect(hook.result.current.analyzerMode).toBe("fallback");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("AudioWorklet is not available"));
    });
  });

  describe("SIMD-disabled environment", () => {
    beforeEach(() => setSimd(false));

    it("activates the AnalyserNode fallback without loading WASM or the worklet", async () => {
      const hook = renderHook(() => useAvionicsAudio());

      expect(await start(hook)).toBe(true);

      expect(ctx.createAnalyser).toHaveBeenCalledTimes(1);
      expect(ctx.audioWorklet!.addModule).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(analyser.fftSize).toBe(FFT);
      expect(analyser.smoothingTimeConstant).toBe(0);
      expect(source.connect).toHaveBeenCalledWith(analyser);
      expect(hook.result.current.analyzerMode).toBe("fallback");
      expect(hook.result.current.isAnalyzerActive).toBe(true);
    });

    it("logs an informational warning when entering fallback mode", async () => {
      const hook = renderHook(() => useAvionicsAudio());

      await start(hook);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/WASM SIMD is not supported.*AnalyserNode fallback/);
    });

    it("emits frames in the exact format the WASM analyzer produces", async () => {
      const hook = renderHook(() => useAvionicsAudio());
      await start(hook);

      act(() => {
        jest.advanceTimersByTime(25);
      });

      const { spectralBins, splDb, dominantFrequencyHz, analyzerLatencyMs } = hook.result.current;
      expect(spectralBins).toBeInstanceOf(Float32Array);
      expect(spectralBins).toHaveLength(HALF);
      expect(typeof splDb).toBe("number");
      expect(typeof dominantFrequencyHz).toBe("number");
      expect(typeof analyzerLatencyMs).toBe("number");
      expect(dominantFrequencyHz).toBeCloseTo((40 * 48000) / FFT, 5);
      expect(splDb).toBeGreaterThanOrEqual(20);
      expect(splDb).toBeLessThanOrEqual(120);
      expect(spectralBins[40]).toBeGreaterThan(spectralBins[41]);
    });

    it("keeps updating on every poll", async () => {
      const hook = renderHook(() => useAvionicsAudio());
      await start(hook);

      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(analyser.getFloatFrequencyData.mock.calls.length).toBeGreaterThan(3);
      expect(analyser.getFloatTimeDomainData.mock.calls.length).toBeGreaterThan(3);
    });

    it("stopFrequencyAnalyzer halts polling and releases every node", async () => {
      const hook = renderHook(() => useAvionicsAudio());
      await start(hook);

      act(() => {
        hook.result.current.stopFrequencyAnalyzer();
      });
      const callsAfterStop = analyser.getFloatFrequencyData.mock.calls.length;
      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(analyser.getFloatFrequencyData.mock.calls.length).toBe(callsAfterStop);
      expect(analyser.disconnect).toHaveBeenCalled();
      expect(source.disconnect).toHaveBeenCalled();
      expect(hook.result.current.isAnalyzerActive).toBe(false);
      expect(hook.result.current.analyzerMode).toBe("inactive");
    });

    it("cleans up the poll timer on unmount", async () => {
      const hook = renderHook(() => useAvionicsAudio());
      await start(hook);

      hook.unmount();
      const callsAfterUnmount = analyser.getFloatFrequencyData.mock.calls.length;
      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(analyser.getFloatFrequencyData.mock.calls.length).toBe(callsAfterUnmount);
      expect(analyser.disconnect).toHaveBeenCalled();
    });

    it("returns false when the fallback itself cannot start", async () => {
      ctx.createAnalyser.mockImplementationOnce(() => {
        throw new Error("no analyser");
      });
      const hook = renderHook(() => useAvionicsAudio());

      expect(await start(hook)).toBe(false);

      expect(hook.result.current.isAnalyzerActive).toBe(false);
      expect(hook.result.current.analyzerMode).toBe("inactive");
    });

    it("restarting replaces the previous analyzer instead of stacking timers", async () => {
      const hook = renderHook(() => useAvionicsAudio());
      await start(hook);
      const firstAnalyser = analyser;
      analyser = makeAnalyser(10, -10);

      await start(hook);
      act(() => {
        jest.advanceTimersByTime(50);
      });

      expect(firstAnalyser.disconnect).toHaveBeenCalled();
      const staleCalls = firstAnalyser.getFloatFrequencyData.mock.calls.length;
      act(() => {
        jest.advanceTimersByTime(50);
      });
      expect(firstAnalyser.getFloatFrequencyData.mock.calls.length).toBe(staleCalls);
    });
  });
});
