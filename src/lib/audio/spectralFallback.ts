/**
 * Spectral analyzer fallback helpers (#8629).
 *
 * The primary acoustic analyzer runs a 128-bit SIMD WebAssembly FFT inside an
 * AudioWorklet (public/worklets/fft-processor.js). Browsers without WASM SIMD
 * (or without AudioWorklet) fall back to the native Web Audio AnalyserNode.
 * These helpers detect that situation and convert AnalyserNode output into
 * exactly the frame the worklet posts, so downstream consumers cannot tell
 * which analyzer produced the data.
 */

/** FFT size shared by the WASM worklet and the fallback (256 bins). */
export const ANALYSER_FFT_SIZE = 512;

/**
 * Smallest module that uses SIMD instructions (`i8x16.splat` followed by
 * `i8x16.popcnt`). `WebAssembly.validate` returns true only on engines that
 * implement the WASM SIMD proposal.
 */
export const WASM_SIMD_PROBE_BYTES = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1,
  8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

/** True when the current engine can run the WASM SIMD FFT analyzer. */
export function detectWasmSimd(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      typeof WebAssembly.validate === "function" &&
      WebAssembly.validate(WASM_SIMD_PROBE_BYTES)
    );
  } catch {
    return false;
  }
}

/** Which analyzer implementation is feeding the spectral state. */
export type AnalyzerMode = "wasm-simd" | "fallback" | "inactive";

/** One analysis frame, identical in shape to the worklet's SPECTRAL_FRAME. */
export interface SpectralFrame {
  /** Linear magnitude per FFT bin (length = fftSize / 2). */
  bins: Float32Array;
  /** Sound pressure level in dB, clamped to 20..120 like the worklet. */
  splDb: number;
  /** Frequency of the strongest non-DC bin in Hz. */
  dominantFrequencyHz: number;
  /** Time spent producing the frame in ms. */
  latencyMs: number;
}

// The worklet reports bins scaled by 2/N after a Hann window, so a sine of
// amplitude A peaks at A * (Hann coherent gain = 0.5). AnalyserNode applies a
// Blackman window (coherent gain 0.42) and reports |X|/N, so the same sine
// peaks at A * 0.42 / 2. This factor maps the second onto the first.
const HANN_COHERENT_GAIN = 0.5;
const BLACKMAN_COHERENT_GAIN = 0.42;

/** Multiplier from AnalyserNode linear magnitude to worklet bin magnitude. */
export const ANALYSER_TO_WORKLET_SCALE =
  (2 * HANN_COHERENT_GAIN) / BLACKMAN_COHERENT_GAIN;

/**
 * Builds a worklet-format frame from AnalyserNode readouts.
 *
 * @param freqDb      getFloatFrequencyData() output (dB, -Infinity for silence)
 * @param timeDomain  getFloatTimeDomainData() output for the same window
 * @param sampleRate  AudioContext sample rate in Hz
 */
export function buildSpectralFrame(
  freqDb: Float32Array,
  timeDomain: Float32Array,
  sampleRate: number,
): SpectralFrame {
  const half = freqDb.length;
  const fftSize = half * 2;

  const bins = new Float32Array(half);
  let peakMag = 0;
  let peakBin = 0;

  for (let b = 0; b < half; b++) {
    const db = freqDb[b];
    const mag = Number.isFinite(db)
      ? Math.pow(10, db / 20) * ANALYSER_TO_WORKLET_SCALE
      : 0;
    bins[b] = mag;
    // Same peak rule as the worklet: skip DC, strictly greater wins.
    if (b > 0 && mag > peakMag) {
      peakMag = mag;
      peakBin = b;
    }
  }

  let sumSquares = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    sumSquares += timeDomain[i] * timeDomain[i];
  }
  const rms = timeDomain.length > 0 ? Math.sqrt(sumSquares / timeDomain.length) : 0;
  const dbfs = rms > 1e-6 ? 20 * Math.log10(rms) : -100;
  const splDb = Math.max(20, Math.min(120, dbfs + 100));

  return {
    bins,
    splDb,
    dominantFrequencyHz: (peakBin * sampleRate) / fftSize,
    latencyMs: 0,
  };
}
