/**
 * wasmSimdDetector.test.ts
 *
 * Unit tests for WebAssembly SIMD Capability Detection and Fallback Benchmark.
 */

import {
  isWasmSupported,
  isSimdSupported,
  runMicroBenchmark,
  getCachedAudioPipeline,
  clearAudioPipelineCache,
  getOptimalPipelineSync,
  determineAudioPipeline,
  AUDIO_PIPELINE_CACHE_KEY,
  SIMD_PROBE_BYTES,
  BASE_WASM_PROBE_BYTES,
} from "@/lib/audio/wasmSimdDetector";

describe("wasmSimdDetector", () => {
  const originalWebAssembly = globalThis.WebAssembly;
  const originalSessionStorage = window.sessionStorage;
  const originalRequestIdleCallback = (
    window as unknown as { requestIdleCallback?: unknown }
  ).requestIdleCallback;

  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    Object.defineProperty(window, "sessionStorage", {
      value: {
        getItem: jest.fn((key: string) => mockStorage[key] || null),
        setItem: jest.fn((key: string, val: string) => {
          mockStorage[key] = val;
        }),
        removeItem: jest.fn((key: string) => {
          delete mockStorage[key];
        }),
        clear: jest.fn(() => {
          mockStorage = {};
        }),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    globalThis.WebAssembly = originalWebAssembly;
    (
      window as unknown as { requestIdleCallback?: unknown }
    ).requestIdleCallback = originalRequestIdleCallback;
    Object.defineProperty(window, "sessionStorage", {
      value: originalSessionStorage,
      writable: true,
      configurable: true,
    });
  });

  describe("isWasmSupported and isSimdSupported", () => {
    it("returns true when WebAssembly.validate returns true", () => {
      globalThis.WebAssembly = {
        validate: jest.fn((bytes: Uint8Array) => {
          return bytes === SIMD_PROBE_BYTES || bytes === BASE_WASM_PROBE_BYTES;
        }),
      } as unknown as typeof WebAssembly;

      expect(isWasmSupported()).toBe(true);
      expect(isSimdSupported()).toBe(true);
    });

    it("returns false when WebAssembly is not available", () => {
      // @ts-expect-error simulating environment without WebAssembly
      delete globalThis.WebAssembly;

      expect(isWasmSupported()).toBe(false);
      expect(isSimdSupported()).toBe(false);
    });

    it("returns false when WebAssembly.validate returns false or throws", () => {
      globalThis.WebAssembly = {
        validate: jest.fn(() => {
          throw new Error("WASM validation error");
        }),
      } as unknown as typeof WebAssembly;

      expect(isWasmSupported()).toBe(false);
      expect(isSimdSupported()).toBe(false);
    });
  });

  describe("runMicroBenchmark", () => {
    it("executes without error and returns execution time in ms", () => {
      const duration = runMicroBenchmark(256);
      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it("handles fallback performance.now if unavailable", () => {
      const originalPerf = globalThis.performance;
      // @ts-expect-error simulating lack of performance.now
      delete globalThis.performance;

      const duration = runMicroBenchmark(128);
      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThanOrEqual(0);

      globalThis.performance = originalPerf;
    });
  });

  describe("sessionStorage caching helpers", () => {
    it("returns null when cache is empty or invalid", () => {
      expect(getCachedAudioPipeline()).toBeNull();

      mockStorage[AUDIO_PIPELINE_CACHE_KEY] = "invalid-pipeline";
      expect(getCachedAudioPipeline()).toBeNull();
    });

    it("returns valid cached pipeline types", () => {
      mockStorage[AUDIO_PIPELINE_CACHE_KEY] = "wasm-simd";
      expect(getCachedAudioPipeline()).toBe("wasm-simd");

      mockStorage[AUDIO_PIPELINE_CACHE_KEY] = "wasm-scalar";
      expect(getCachedAudioPipeline()).toBe("wasm-scalar");

      mockStorage[AUDIO_PIPELINE_CACHE_KEY] = "web-audio-analyser";
      expect(getCachedAudioPipeline()).toBe("web-audio-analyser");
    });

    it("clears cached decision", () => {
      mockStorage[AUDIO_PIPELINE_CACHE_KEY] = "wasm-simd";
      clearAudioPipelineCache();
      expect(mockStorage[AUDIO_PIPELINE_CACHE_KEY]).toBeUndefined();
    });

    it("handles storage errors without throwing", () => {
      Object.defineProperty(window, "sessionStorage", {
        value: {
          getItem: jest.fn(() => {
            throw new Error("QuotaExceeded");
          }),
          removeItem: jest.fn(() => {
            throw new Error("SecurityError");
          }),
          setItem: jest.fn(() => {
            throw new Error("SecurityError");
          }),
        },
        writable: true,
        configurable: true,
      });

      expect(() => getCachedAudioPipeline()).not.toThrow();
      expect(getCachedAudioPipeline()).toBeNull();
      expect(() => clearAudioPipelineCache()).not.toThrow();
    });
  });

  describe("getOptimalPipelineSync", () => {
    it("returns cached pipeline when present", () => {
      mockStorage[AUDIO_PIPELINE_CACHE_KEY] = "wasm-scalar";
      expect(getOptimalPipelineSync()).toBe("wasm-scalar");
    });

    it("returns wasm-simd when SIMD probe succeeds", () => {
      globalThis.WebAssembly = {
        validate: jest.fn((bytes: Uint8Array) => bytes === SIMD_PROBE_BYTES),
      } as unknown as typeof WebAssembly;

      expect(getOptimalPipelineSync()).toBe("wasm-simd");
    });

    it("returns wasm-scalar when only base WASM probe succeeds", () => {
      globalThis.WebAssembly = {
        validate: jest.fn(
          (bytes: Uint8Array) => bytes === BASE_WASM_PROBE_BYTES,
        ),
      } as unknown as typeof WebAssembly;

      expect(getOptimalPipelineSync()).toBe("wasm-scalar");
    });

    it("returns web-audio-analyser when WebAssembly is unsupported", () => {
      // @ts-expect-error simulating lack of WebAssembly
      delete globalThis.WebAssembly;
      expect(getOptimalPipelineSync()).toBe("web-audio-analyser");
    });
  });

  describe("determineAudioPipeline", () => {
    it("returns cached result immediately when cache exists and bypassCache is false", async () => {
      mockStorage[AUDIO_PIPELINE_CACHE_KEY] = "wasm-simd";

      const result = await determineAudioPipeline({ bypassCache: false });
      expect(result.cached).toBe(true);
      expect(result.pipeline).toBe("wasm-simd");
      expect(result.hasWasm).toBe(true);
      expect(result.hasSimd).toBe(true);
      expect(result.recommendedFftSize).toBe(2048);
    });

    it("falls back to web-audio-analyser if WebAssembly is absent", async () => {
      // @ts-expect-error simulating lack of WebAssembly
      delete globalThis.WebAssembly;

      const result = await determineAudioPipeline({ bypassCache: true });
      expect(result.pipeline).toBe("web-audio-analyser");
      expect(result.hasWasm).toBe(false);
      expect(result.hasSimd).toBe(false);
      expect(result.recommendedFftSize).toBe(512);
      expect(mockStorage[AUDIO_PIPELINE_CACHE_KEY]).toBe("web-audio-analyser");
    });

    it("selects wasm-simd when SIMD is supported and benchmark is fast", async () => {
      globalThis.WebAssembly = {
        validate: jest.fn(() => true),
      } as unknown as typeof WebAssembly;

      const result = await determineAudioPipeline({
        bypassCache: true,
        benchmarkSamples: 128,
      });

      expect(result.pipeline).toBe("wasm-simd");
      expect(result.hasSimd).toBe(true);
      expect(result.hasWasm).toBe(true);
      expect(result.recommendedFftSize).toBe(2048);
      expect(mockStorage[AUDIO_PIPELINE_CACHE_KEY]).toBe("wasm-simd");
    });

    it("selects wasm-scalar when SIMD is unavailable but base WASM is fast", async () => {
      globalThis.WebAssembly = {
        validate: jest.fn(
          (bytes: Uint8Array) => bytes === BASE_WASM_PROBE_BYTES,
        ),
      } as unknown as typeof WebAssembly;

      const result = await determineAudioPipeline({
        bypassCache: true,
        benchmarkSamples: 128,
      });

      expect(result.pipeline).toBe("wasm-scalar");
      expect(result.hasSimd).toBe(false);
      expect(result.hasWasm).toBe(true);
      expect(result.recommendedFftSize).toBe(1024);
      expect(mockStorage[AUDIO_PIPELINE_CACHE_KEY]).toBe("wasm-scalar");
    });

    it("uses requestIdleCallback when available in window", async () => {
      globalThis.WebAssembly = {
        validate: jest.fn(() => true),
      } as unknown as typeof WebAssembly;

      const mockRequestIdleCallback = jest.fn((cb: () => void) => {
        cb();
        return 1;
      });
      (
        window as unknown as { requestIdleCallback?: unknown }
      ).requestIdleCallback = mockRequestIdleCallback;

      const result = await determineAudioPipeline({
        bypassCache: true,
        benchmarkSamples: 64,
      });
      expect(mockRequestIdleCallback).toHaveBeenCalled();
      expect(result.pipeline).toBe("wasm-simd");
    });
  });
});
