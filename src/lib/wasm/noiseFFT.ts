/**
 * noiseFFT.ts
 *
 * WebAssembly-accelerated noise calculation engine with JavaScript Web Audio fallback
 * and CPU usage benchmarking for low-power mobile devices.
 */

export interface NoiseFFTExports {
  memory: WebAssembly.Memory;
  wasm_malloc: (size: number) => number;
  wasm_free: (ptr: number) => void;
  compute_rms: (ptr: number, count: number) => number;
  rms_to_db: (rms: number) => number;
  process_noise_frame: (
    samplesPtr: number,
    sampleCount: number,
    fftSize: number,
    spectrumPtr: number,
    metricsPtr: number,
  ) => number;
}

export interface NoiseMetricsResult {
  rms: number;
  averageDb: number;
  peakDb: number;
  spectrum: Float32Array;
  mode: "wasm" | "javascript";
  executionTimeMs: number;
}

export interface NoiseEngineBenchmarkResult {
  wasmTimeMs: number;
  jsTimeMs: number;
  cpuReductionPercent: number;
  recommendedMode: "wasm" | "javascript";
  iterations: number;
}

let wasmInstancePromise: Promise<NoiseFFTExports> | null = null;
let isWasmSupportedAndLoaded = false;

function align8(n: number): number {
  return (n + 7) & ~7;
}

/**
 * JS Fallback Implementation of Cooley-Tukey Radix-2 FFT and Decibel calculation.
 */
export function computeFFTJS(
  samples: Float32Array,
  fftSize = 512,
): { rms: number; averageDb: number; peakDb: number; spectrum: Float32Array } {
  const count = samples.length;
  if (count === 0) {
    return {
      rms: 0,
      averageDb: 20,
      peakDb: 20,
      spectrum: new Float32Array(0),
    };
  }

  // 1. RMS & dB
  let sumSq = 0;
  let peakSample = 0;
  for (let i = 0; i < count; i++) {
    const val = samples[i];
    sumSq += val * val;
    const absVal = Math.abs(val);
    if (absVal > peakSample) peakSample = absVal;
  }

  const rms = Math.sqrt(sumSq / count);
  const rmsToDb = (v: number) => {
    if (v <= 0.00001) return 20;
    const dbfs = 20 * Math.log10(v);
    const db = dbfs + 100;
    return Math.max(20, Math.min(120, Math.round(db * 10) / 10));
  };

  const averageDb = rmsToDb(rms);
  const peakDb = rmsToDb(peakSample);

  // 2. Cooley-Tukey FFT Spectrum calculation
  const n = Math.min(count, fftSize);
  const halfN = Math.floor(n / 2);
  const spectrum = new Float32Array(halfN);

  const real = new Float32Array(n);
  const imag = new Float32Array(n);

  // Bit reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    real[j] = samples[i];
    imag[j] = 0;
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  // FFT butterflies
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wlenR = Math.cos(angle);
    const wlenI = Math.sin(angle);
    const halfLen = len >> 1;

    for (let i = 0; i < n; i += len) {
      let wR = 1;
      let wI = 0;
      for (let k = 0; k < halfLen; k++) {
        const u = i + k;
        const v = i + k + halfLen;
        const uR = real[u];
        const uI = imag[u];
        const vR = real[v] * wR - imag[v] * wI;
        const vI = real[v] * wI + imag[v] * wR;

        real[u] = uR + vR;
        imag[u] = uI + vI;
        real[v] = uR - vR;
        imag[v] = uI - vI;

        const nextWR = wR * wlenR - wI * wlenI;
        const nextWI = wR * wlenI + wI * wlenR;
        wR = nextWR;
        wI = nextWI;
      }
    }
  }

  for (let i = 0; i < halfN; i++) {
    spectrum[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / n;
  }

  return { rms, averageDb, peakDb, spectrum };
}

/**
 * Load the WASM module with graceful fallback.
 */
export async function loadNoiseFFTWasm(): Promise<NoiseFFTExports | null> {
  if (typeof WebAssembly === "undefined") {
    isWasmSupportedAndLoaded = false;
    return null;
  }

  if (!wasmInstancePromise) {
    wasmInstancePromise = (async () => {
      try {
        const response = await fetch("/noise-fft.wasm");
        if (!response.ok) throw new Error("Failed to fetch WASM binary");
        const bytes = await response.arrayBuffer();
        const compiled = await WebAssembly.compile(bytes);
        const instance = await WebAssembly.instantiate(compiled);
        isWasmSupportedAndLoaded = true;
        return instance.exports as unknown as NoiseFFTExports;
      } catch (err) {
        isWasmSupportedAndLoaded = false;
        console.warn(
          "[NoiseFFT] WebAssembly compilation failed, using JS fallback:",
          err,
        );
        throw err;
      }
    })();
  }

  try {
    return await wasmInstancePromise;
  } catch {
    return null;
  }
}

export function isWasmLoaded(): boolean {
  return isWasmSupportedAndLoaded;
}

export function resetNoiseFFTEngine(): void {
  wasmInstancePromise = null;
  isWasmSupportedAndLoaded = false;
}

/**
 * Process audio frame using WASM if available, or JS Web Audio fallback.
 */
export async function processAudioNoiseFrame(
  samples: Float32Array,
  fftSize = 512,
): Promise<NoiseMetricsResult> {
  const startTime = performance.now();
  const wasm = await loadNoiseFFTWasm();

  if (wasm) {
    try {
      const sampleCount = samples.length;
      const halfFFT = Math.floor(fftSize / 2);
      const samplesBytes = align8(sampleCount * 4);
      const spectrumBytes = align8(halfFFT * 4);
      const metricsBytes = align8(3 * 4);

      const samplesPtr = wasm.wasm_malloc(samplesBytes);
      const spectrumPtr = wasm.wasm_malloc(spectrumBytes);
      const metricsPtr = wasm.wasm_malloc(metricsBytes);

      // Copy samples to WASM memory
      const sampleView = new Float32Array(
        wasm.memory.buffer,
        samplesPtr,
        sampleCount,
      );
      sampleView.set(samples);

      wasm.process_noise_frame(
        samplesPtr,
        sampleCount,
        fftSize,
        spectrumPtr,
        metricsPtr,
      );

      const metricsView = new Float32Array(wasm.memory.buffer, metricsPtr, 3);
      const rms = metricsView[0];
      const averageDb = metricsView[1];
      const peakDb = metricsView[2];

      const spectrumCopy = new Float32Array(halfFFT);
      if (spectrumPtr) {
        const spectrumView = new Float32Array(
          wasm.memory.buffer,
          spectrumPtr,
          halfFFT,
        );
        spectrumCopy.set(spectrumView);
      }

      wasm.wasm_free(samplesPtr);
      wasm.wasm_free(spectrumPtr);
      wasm.wasm_free(metricsPtr);

      const endTime = performance.now();
      return {
        rms,
        averageDb,
        peakDb,
        spectrum: spectrumCopy,
        mode: "wasm",
        executionTimeMs: Math.max(0.01, endTime - startTime),
      };
    } catch (err) {
      console.warn(
        "[NoiseFFT] Error during WASM execution, falling back to JS:",
        err,
      );
    }
  }

  // JS Fallback Execution
  const fallbackResult = computeFFTJS(samples, fftSize);
  const endTime = performance.now();
  return {
    ...fallbackResult,
    mode: "javascript",
    executionTimeMs: Math.max(0.01, endTime - startTime),
  };
}

/**
 * Benchmark CPU reduction between WASM and JS execution mode.
 */
export async function benchmarkNoiseEngine(
  samples: Float32Array,
  iterations = 50,
): Promise<NoiseEngineBenchmarkResult> {
  const fftSize = 512;

  // Measure JS Fallback Time
  const jsStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    computeFFTJS(samples, fftSize);
  }
  const jsTotalTime = performance.now() - jsStart;
  const jsAvgTimeMs = jsTotalTime / iterations;

  // Measure WASM Time
  let wasmAvgTimeMs = jsAvgTimeMs;
  let wasmSuccess = false;

  const wasm = await loadNoiseFFTWasm();
  if (wasm) {
    try {
      const sampleCount = samples.length;
      const halfFFT = Math.floor(fftSize / 2);
      const samplesBytes = align8(sampleCount * 4);
      const spectrumBytes = align8(halfFFT * 4);
      const metricsBytes = align8(3 * 4);

      const samplesPtr = wasm.wasm_malloc(samplesBytes);
      const spectrumPtr = wasm.wasm_malloc(spectrumBytes);
      const metricsPtr = wasm.wasm_malloc(metricsBytes);

      const wasmStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        const sampleView = new Float32Array(
          wasm.memory.buffer,
          samplesPtr,
          sampleCount,
        );
        sampleView.set(samples);
        wasm.process_noise_frame(
          samplesPtr,
          sampleCount,
          fftSize,
          spectrumPtr,
          metricsPtr,
        );
      }
      const wasmTotalTime = performance.now() - wasmStart;
      wasmAvgTimeMs = wasmTotalTime / iterations;

      wasm.wasm_free(samplesPtr);
      wasm.wasm_free(spectrumPtr);
      wasm.wasm_free(metricsPtr);
      wasmSuccess = true;
    } catch {
      wasmSuccess = false;
    }
  }

  const reduction =
    wasmSuccess && jsAvgTimeMs > 0
      ? Math.max(0, ((jsAvgTimeMs - wasmAvgTimeMs) / jsAvgTimeMs) * 100)
      : 0;

  return {
    wasmTimeMs: Math.round(wasmAvgTimeMs * 1000) / 1000,
    jsTimeMs: Math.round(jsAvgTimeMs * 1000) / 1000,
    cpuReductionPercent: Math.round(reduction * 10) / 10,
    recommendedMode:
      wasmSuccess && wasmAvgTimeMs < jsAvgTimeMs ? "wasm" : "javascript",
    iterations,
  };
}
