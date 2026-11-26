/**
 * wasmSimdDetector.ts
 *
 * Automatic WebAssembly SIMD Capability Detection and Performance Benchmark
 * for Real-Time Acoustic Privacy and Spectral Analysis (#10009).
 *
 * Provides:
 * - Runtime detection of WebAssembly 128-bit SIMD instruction support
 * - Micro-benchmark execution scheduled via requestIdleCallback (with setTimeout fallback)
 * - Dynamic pipeline determination: 'wasm-simd' | 'wasm-scalar' | 'web-audio-analyser'
 * - Session-level caching in sessionStorage to prevent repeated benchmark execution
 */

export type AudioPipelineType =
  "wasm-simd" | "wasm-scalar" | "web-audio-analyser";

export interface WasmCapabilityResult {
  /** Selected optimal DSP audio processing pipeline */
  pipeline: AudioPipelineType;
  /** Whether the runtime supports base WebAssembly */
  hasWasm: boolean;
  /** Whether the runtime supports WebAssembly 128-bit SIMD */
  hasSimd: boolean;
  /** Micro-benchmark execution duration in milliseconds */
  benchmarkDurationMs: number;
  /** Number of synthetic audio samples evaluated during benchmark */
  samplesProcessed: number;
  /** Whether this result was retrieved from sessionStorage cache */
  cached: boolean;
  /** Optimal FFT frame size recommended based on performance profile */
  recommendedFftSize: number;
}

export const AUDIO_PIPELINE_CACHE_KEY = "worksphere:audio-pipeline";

/**
 * 128-bit SIMD test probe bytecode (i8x16.splat followed by i8x16.popcnt).
 * WebAssembly.validate returns true only on runtimes implementing the WASM SIMD proposal.
 */
export const SIMD_PROBE_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00,
  0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00,
  0xfd, 0x0f, 0xfd, 0x62, 0x0b,
]);

/**
 * Baseline WebAssembly module probe (empty valid module).
 */
export const BASE_WASM_PROBE_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);

export const DEFAULT_BENCHMARK_SAMPLES = 1024;
export const MAX_ACCEPTABLE_SIMD_BENCHMARK_MS = 25.0;
export const MAX_ACCEPTABLE_SCALAR_BENCHMARK_MS = 35.0;

/**
 * Detects whether base WebAssembly is supported in the current environment.
 */
export function isWasmSupported(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      WebAssembly !== null &&
      typeof WebAssembly.validate === "function" &&
      WebAssembly.validate(BASE_WASM_PROBE_BYTES)
    );
  } catch {
    return false;
  }
}

/**
 * Detects whether WebAssembly 128-bit SIMD instructions are supported in the current environment.
 */
export function isSimdSupported(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      WebAssembly !== null &&
      typeof WebAssembly.validate === "function" &&
      WebAssembly.validate(SIMD_PROBE_BYTES)
    );
  } catch {
    return false;
  }
}

/**
 * Runs a CPU-intensive micro-benchmark simulating audio buffer filtering and FFT butterfly math
 * to ensure client hardware maintains real-time throughput without frame drops.
 *
 * @param sampleCount Number of synthetic samples to process (default: 1024)
 * @returns Benchmark duration in milliseconds
 */
export function runMicroBenchmark(
  sampleCount: number = DEFAULT_BENCHMARK_SAMPLES,
): number {
  const perf =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance
      : { now: () => Date.now() };

  const real = new Float32Array(sampleCount);
  const imag = new Float32Array(sampleCount);

  // Initialize with synthetic sine wave + noise
  for (let i = 0; i < sampleCount; i++) {
    real[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.8;
    imag[i] = 0;
  }

  const start = perf.now();

  // Synthetic Hann windowing pass
  for (let i = 0; i < sampleCount; i++) {
    const windowVal =
      0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (sampleCount - 1)));
    real[i] *= windowVal;
  }

  // Simulated butterfly cross-multiplication pass (Radix-2 stages)
  let half = sampleCount >> 1;
  while (half >= 1) {
    for (let i = 0; i < half; i++) {
      const angle = (-2.0 * Math.PI * i) / sampleCount;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const r = real[i + half];
      const im = imag[i + half];

      const tr = r * cosA - im * sinA;
      const ti = r * sinA + im * cosA;

      real[i + half] = real[i] - tr;
      imag[i + half] = imag[i] - ti;
      real[i] += tr;
      imag[i] += ti;
    }
    half >>= 1;
  }

  const end = perf.now();
  return Math.max(0, end - start);
}

/**
 * Retrieves previously cached pipeline configuration from sessionStorage.
 */
export function getCachedAudioPipeline(): AudioPipelineType | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const cached = window.sessionStorage.getItem(AUDIO_PIPELINE_CACHE_KEY);
      if (
        cached === "wasm-simd" ||
        cached === "wasm-scalar" ||
        cached === "web-audio-analyser"
      ) {
        return cached;
      }
    }
  } catch {
    // Ignore storage quota or security errors
  }
  return null;
}

/**
 * Clears cached audio pipeline decision from sessionStorage.
 */
export function clearAudioPipelineCache(): void {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(AUDIO_PIPELINE_CACHE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Synchronous determination of best available pipeline based on hardware feature probes only.
 * Useful when audio engine must mount synchronously before idle benchmark completes.
 */
export function getOptimalPipelineSync(): AudioPipelineType {
  const cached = getCachedAudioPipeline();
  if (cached) {
    return cached;
  }

  if (isSimdSupported()) {
    return "wasm-simd";
  }

  if (isWasmSupported()) {
    return "wasm-scalar";
  }

  return "web-audio-analyser";
}

export interface DeterminePipelineOptions {
  bypassCache?: boolean;
  benchmarkSamples?: number;
  timeoutMs?: number;
}

/**
 * Asynchronously determines the optimal audio DSP pipeline.
 *
 * Runs capability detection, defers the micro-benchmark to requestIdleCallback
 * to avoid jank on the main thread, and caches the decision in sessionStorage.
 */
export async function determineAudioPipeline(
  options: DeterminePipelineOptions = {},
): Promise<WasmCapabilityResult> {
  const {
    bypassCache = false,
    benchmarkSamples = DEFAULT_BENCHMARK_SAMPLES,
    timeoutMs = 500,
  } = options;

  if (!bypassCache) {
    const cachedPipeline = getCachedAudioPipeline();
    if (cachedPipeline) {
      const hasWasm = cachedPipeline !== "web-audio-analyser";
      const hasSimd = cachedPipeline === "wasm-simd";
      return {
        pipeline: cachedPipeline,
        hasWasm,
        hasSimd,
        benchmarkDurationMs: 0,
        samplesProcessed: benchmarkSamples,
        cached: true,
        recommendedFftSize: hasSimd ? 2048 : 1024,
      };
    }
  }

  const hasWasm = isWasmSupported();
  const hasSimd = isSimdSupported();

  // If environment lacks WebAssembly entirely, immediately fall back to Web Audio API
  if (!hasWasm) {
    const fallbackResult: WasmCapabilityResult = {
      pipeline: "web-audio-analyser",
      hasWasm: false,
      hasSimd: false,
      benchmarkDurationMs: 0,
      samplesProcessed: benchmarkSamples,
      cached: false,
      recommendedFftSize: 512,
    };
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.setItem(
          AUDIO_PIPELINE_CACHE_KEY,
          fallbackResult.pipeline,
        );
      }
    } catch {
      // Ignore storage errors
    }
    return fallbackResult;
  }

  // Defer benchmark to requestIdleCallback or setTimeout
  const benchmarkDuration = await new Promise<number>((resolve) => {
    const run = () => {
      try {
        const duration = runMicroBenchmark(benchmarkSamples);
        resolve(duration);
      } catch {
        resolve(999.0); // Extreme duration on error triggers safe fallback
      }
    };

    if (
      typeof window !== "undefined" &&
      typeof window.requestIdleCallback === "function"
    ) {
      window.requestIdleCallback(run, { timeout: timeoutMs });
    } else {
      setTimeout(run, 0);
    }
  });

  let selectedPipeline: AudioPipelineType = "web-audio-analyser";
  let recommendedFftSize = 512;

  if (hasSimd) {
    if (benchmarkDuration <= MAX_ACCEPTABLE_SIMD_BENCHMARK_MS) {
      selectedPipeline = "wasm-simd";
      recommendedFftSize = 2048;
    } else {
      // Under heavy throttling, step down to scalar or analyser
      selectedPipeline = "wasm-scalar";
      recommendedFftSize = 1024;
    }
  } else if (hasWasm) {
    if (benchmarkDuration <= MAX_ACCEPTABLE_SCALAR_BENCHMARK_MS) {
      selectedPipeline = "wasm-scalar";
      recommendedFftSize = 1024;
    } else {
      selectedPipeline = "web-audio-analyser";
      recommendedFftSize = 512;
    }
  }

  // Cache in sessionStorage
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(AUDIO_PIPELINE_CACHE_KEY, selectedPipeline);
    }
  } catch {
    // Ignore storage errors
  }

  return {
    pipeline: selectedPipeline,
    hasWasm,
    hasSimd,
    benchmarkDurationMs: benchmarkDuration,
    samplesProcessed: benchmarkSamples,
    cached: false,
    recommendedFftSize,
  };
}
