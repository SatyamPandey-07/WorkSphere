/**
 * WASM SIMD multi-channel audio filter pipeline (#1998).
 *
 * Loads the clang-compiled biquad cascade from `wasm/audio-filter/audio_filter.c`
 * and exposes a typed API for filtering planar multi-channel buffers in place.
 * Coefficients are designed here (RBJ Audio EQ Cookbook) so the WASM module
 * stays libm-free; the hot per-sample loop runs in WASM, 4 channels per v128.
 */

export type BiquadFilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "notch"
  | "peaking"
  | "lowshelf"
  | "highshelf";

export interface BiquadStageConfig {
  type: BiquadFilterType;
  /** Corner / centre frequency in Hz. Must be in (0, sampleRate / 2). */
  frequency: number;
  /** Quality factor. Defaults to 1/√2 (Butterworth). */
  q?: number;
  /** Boost/cut in dB. Used by peaking and shelf filters only. */
  gainDb?: number;
}

/** Biquad coefficients normalised so that a0 = 1. */
export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export const SIMD_WASM_URL = "/audio-filter-simd.wasm";
export const SCALAR_WASM_URL = "/audio-filter-scalar.wasm";

/** Minimal module containing a v128.const; validates only where wasm SIMD exists. */
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00,
  0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x0b,
]);

export function isWasmSimdSupported(): boolean {
  try {
    return (
      typeof WebAssembly !== "undefined" && WebAssembly.validate(SIMD_PROBE)
    );
  } catch {
    return false;
  }
}

/**
 * Design one biquad stage using the RBJ Audio EQ Cookbook formulas.
 * Throws on parameters that would produce an unstable or undefined filter.
 */
export function designBiquad(
  stage: BiquadStageConfig,
  sampleRate: number,
): BiquadCoefficients {
  const { type, frequency } = stage;
  const q = stage.q ?? Math.SQRT1_2;
  const gainDb = stage.gainDb ?? 0;

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("sampleRate must be a positive finite number");
  }
  if (!Number.isFinite(frequency) || frequency <= 0 || frequency >= sampleRate / 2) {
    throw new RangeError(
      `frequency must be in (0, ${sampleRate / 2}) Hz, got ${frequency}`,
    );
  }
  if (!Number.isFinite(q) || q <= 0) {
    throw new RangeError("q must be a positive finite number");
  }
  if (!Number.isFinite(gainDb)) {
    throw new RangeError("gainDb must be finite");
  }

  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

  switch (type) {
    case "lowpass":
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "bandpass":
      // Constant 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case "lowshelf":
      b0 = A * (A + 1 - (A - 1) * cos + sqrtA2alpha);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - sqrtA2alpha);
      a0 = A + 1 + (A - 1) * cos + sqrtA2alpha;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - sqrtA2alpha;
      break;
    case "highshelf":
      b0 = A * (A + 1 + (A - 1) * cos + sqrtA2alpha);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - sqrtA2alpha);
      a0 = A + 1 - (A - 1) * cos + sqrtA2alpha;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - sqrtA2alpha;
      break;
    default:
      throw new TypeError(`Unknown biquad filter type: ${String(type)}`);
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Magnitude response of a biquad at `frequency` Hz, in dB. */
export function biquadMagnitudeDb(
  c: BiquadCoefficients,
  frequency: number,
  sampleRate: number,
): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const numRe = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const numIm = -(c.b1 * sin1 + c.b2 * sin2);
  const denRe = 1 + c.a1 * cos1 + c.a2 * cos2;
  const denIm = -(c.a1 * sin1 + c.a2 * sin2);
  const mag = Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
  return 20 * Math.log10(mag);
}

interface AudioFilterExports {
  memory: WebAssembly.Memory;
  getBufferPtr(): number;
  getMaxChannels(): number;
  getMaxFrames(): number;
  getMaxStages(): number;
  isSIMDBuild(): number;
  setSIMDEnabled(enabled: number): void;
  reset(): void;
  setStageCount(count: number): number;
  setStage(
    index: number,
    b0: number,
    b1: number,
    b2: number,
    a1: number,
    a2: number,
  ): number;
  setOutputGain(gain: number): void;
  process(numChannels: number, numFrames: number): number;
}

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Stateful multi-channel biquad cascade backed by a WASM module.
 * Filter state persists across process() calls, so a stream can be fed
 * block by block (e.g. 128-frame AudioWorklet render quanta).
 */
export class AudioFilterPipeline {
  readonly maxChannels: number;
  readonly maxFrames: number;
  readonly maxStages: number;
  /** True when the loaded module was compiled with -msimd128. */
  readonly simd: boolean;

  private constructor(private readonly wasm: AudioFilterExports) {
    this.maxChannels = wasm.getMaxChannels();
    this.maxFrames = wasm.getMaxFrames();
    this.maxStages = wasm.getMaxStages();
    this.simd = wasm.isSIMDBuild() === 1;
  }

  /** Instantiate from compiled bytes (either the SIMD or the scalar build). */
  static async fromBinary(bytes: BufferSource): Promise<AudioFilterPipeline> {
    const { instance } = await WebAssembly.instantiate(bytes);
    return new AudioFilterPipeline(
      instance.exports as unknown as AudioFilterExports,
    );
  }

  /** Replace the filter chain. Resets filter state. */
  setStages(stages: BiquadStageConfig[], sampleRate: number): void {
    this.setCoefficients(stages.map((s) => designBiquad(s, sampleRate)));
  }

  /** Replace the filter chain with pre-designed coefficients. Resets state. */
  setCoefficients(coefficients: BiquadCoefficients[]): void {
    if (coefficients.length > this.maxStages) {
      throw new RangeError(
        `At most ${this.maxStages} filter stages are supported, got ${coefficients.length}`,
      );
    }
    coefficients.forEach((c, i) => {
      this.wasm.setStage(i, c.b0, c.b1, c.b2, c.a1, c.a2);
    });
    this.wasm.setStageCount(coefficients.length);
  }

  /** Linear gain applied after the filter chain. */
  setOutputGain(gain: number): void {
    if (!Number.isFinite(gain)) throw new RangeError("gain must be finite");
    this.wasm.setOutputGain(gain);
  }

  /** Force the scalar path inside a SIMD build (no-op for the scalar build). */
  setSimdEnabled(enabled: boolean): void {
    this.wasm.setSIMDEnabled(enabled ? 1 : 0);
  }

  /** Clear filter delay lines (e.g. after a seek or stream restart). */
  reset(): void {
    this.wasm.reset();
  }

  /**
   * Filter planar channels in place. All channels must share one length;
   * buffers longer than maxFrames are processed in chunks with continuous
   * state. Returns the elapsed processing time in milliseconds.
   */
  process(channels: Float32Array[]): number {
    const numChannels = channels.length;
    if (numChannels < 1 || numChannels > this.maxChannels) {
      throw new RangeError(
        `Expected 1-${this.maxChannels} channels, got ${numChannels}`,
      );
    }
    const length = channels[0].length;
    if (channels.some((ch) => ch.length !== length)) {
      throw new RangeError("All channels must have the same length");
    }

    const start = now();
    const basePtr = this.wasm.getBufferPtr();
    const heap = new Float32Array(this.wasm.memory.buffer);
    const baseIndex = basePtr / Float32Array.BYTES_PER_ELEMENT;

    for (let offset = 0; offset < length; offset += this.maxFrames) {
      const frames = Math.min(this.maxFrames, length - offset);
      for (let c = 0; c < numChannels; c++) {
        heap.set(
          channels[c].subarray(offset, offset + frames),
          baseIndex + c * this.maxFrames,
        );
      }
      if (this.wasm.process(numChannels, frames) !== 0) {
        throw new Error("WASM audio filter rejected the buffer dimensions");
      }
      for (let c = 0; c < numChannels; c++) {
        const rowStart = baseIndex + c * this.maxFrames;
        channels[c].set(heap.subarray(rowStart, rowStart + frames), offset);
      }
    }

    return now() - start;
  }
}

/**
 * Fetch and instantiate the best available build: SIMD when the engine
 * supports wasm SIMD, otherwise the scalar fallback.
 */
export async function loadAudioFilterPipeline(
  options: { simdUrl?: string; scalarUrl?: string; forceScalar?: boolean } = {},
): Promise<AudioFilterPipeline> {
  const useSimd = !options.forceScalar && isWasmSimdSupported();
  const url = useSimd
    ? (options.simdUrl ?? SIMD_WASM_URL)
    : (options.scalarUrl ?? SCALAR_WASM_URL);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load audio filter WASM (${url}): ${response.status}`);
  }
  return AudioFilterPipeline.fromBinary(await response.arrayBuffer());
}
