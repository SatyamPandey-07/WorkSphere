/**
 * WasmSoundClassifier.ts
 * Loads the Rust/WebAssembly acoustic classifier (src/wasm/acoustic/sound_classifier.rs)
 * and exposes it to the client thread (#7277).
 *
 * Privacy: the only network request this file makes is a one-time fetch of the
 * `.wasm` code itself. The module declares no imports, so it cannot call out of
 * its sandbox, and audio samples are only ever copied into its linear memory,
 * where the next frame overwrites them. Nothing here posts, stores or logs audio.
 */

export const SOUND_FRAME_LENGTH = 1024;
export const MFCC_COUNT = 13;

export type SoundLabel = 'silence' | 'chatter' | 'grinder' | 'other';

export interface SoundFeatures {
  /** 13 mel-frequency cepstral coefficients (copy; safe to keep). */
  mfcc: Float32Array;
  spectralCentroidHz: number;
  rmsDbfs: number;
  /** 0 = pure tone, 1 = white-noise-like (geometric / arithmetic mean of the spectrum). */
  spectralFlatness: number;
  /** Share of spectral energy between 300 and 3400 Hz, 0..1. */
  speechBandRatio: number;
  /** Rule-based label, not a trained model; see the thresholds in sound_classifier.rs. */
  label: SoundLabel;
  /** Wall-clock time of the wasm call only, in milliseconds. */
  processingMs: number;
}

export interface WasmSoundClassifierOptions {
  /** Sample rate of the frames you will pass in (Hz). Defaults to 44100. */
  sampleRate?: number;
  /** Where to fetch the SIMD build. Default `/sound_classifier.wasm`. */
  simdUrl?: string;
  /** Where to fetch the scalar build. Default `/sound_classifier_scalar.wasm`. */
  scalarUrl?: string;
  /** Provide compiled bytes directly (skips fetch; used by tests and workers). */
  wasmBytes?: BufferSource;
  /** Force a build regardless of feature detection. */
  forceScalar?: boolean;
}

interface ClassifierExports {
  memory: WebAssembly.Memory;
  sc_init(sampleRate: number): number;
  sc_input_ptr(): number;
  sc_output_ptr(): number;
  sc_process(): number;
  sc_frame_len(): number;
  sc_output_len(): number;
  sc_simd_enabled(): number;
}

const LABELS: SoundLabel[] = ['silence', 'chatter', 'grinder', 'other'];
const ERR_BAD_SAMPLE_RATE = 253;
const ERR_NON_FINITE = 254;
const ERR_NOT_INITIALISED = 255;

// Smallest module using a v128 instruction; validates only if the engine supports wasm SIMD.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
  15, 253, 98, 11,
]);

export function isWasmSimdSupported(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

export class WasmSoundClassifier {
  private input: Float32Array;
  private output: Float32Array;
  private readonly inputPtr: number;
  private readonly outputPtr: number;
  private disposed = false;

  private constructor(
    private readonly api: ClassifierExports,
    readonly simd: boolean,
    readonly sampleRate: number
  ) {
    this.inputPtr = api.sc_input_ptr();
    this.outputPtr = api.sc_output_ptr();
    this.input = new Float32Array(api.memory.buffer, this.inputPtr, SOUND_FRAME_LENGTH);
    this.output = new Float32Array(api.memory.buffer, this.outputPtr, api.sc_output_len());
  }

  static async create(options: WasmSoundClassifierOptions = {}): Promise<WasmSoundClassifier> {
    const sampleRate = options.sampleRate ?? 44100;
    const useSimd = !options.forceScalar && isWasmSimdSupported();

    let bytes: BufferSource;
    if (options.wasmBytes) {
      bytes = options.wasmBytes;
    } else {
      const url = useSimd
        ? (options.simdUrl ?? '/sound_classifier.wasm')
        : (options.scalarUrl ?? '/sound_classifier_scalar.wasm');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
      bytes = await res.arrayBuffer();
    }

    const { instance } = await WebAssembly.instantiate(bytes, {});
    const api = instance.exports as unknown as ClassifierExports;
    if (api.sc_frame_len() !== SOUND_FRAME_LENGTH) {
      throw new Error('sound_classifier.wasm frame length mismatch; rebuild the module');
    }
    const status = api.sc_init(sampleRate);
    if (status === ERR_BAD_SAMPLE_RATE) {
      throw new RangeError(`Unsupported sample rate: ${sampleRate} Hz (need 4000-192000)`);
    }
    return new WasmSoundClassifier(api, api.sc_simd_enabled() === 1, sampleRate);
  }

  /**
   * Analyses one frame of mono PCM in [-1, 1]. Frames shorter than 1024 samples are
   * zero-padded; longer frames are rejected. Throws on NaN/Infinity samples.
   */
  classify(frame: Float32Array): SoundFeatures {
    if (this.disposed) throw new Error('WasmSoundClassifier has been disposed');
    if (frame.length === 0 || frame.length > SOUND_FRAME_LENGTH) {
      throw new RangeError(`frame must contain 1-${SOUND_FRAME_LENGTH} samples, got ${frame.length}`);
    }

    // Memory can only move if the module grows it; re-bind views if that ever happens.
    const buffer = this.api.memory.buffer;
    if (this.input.buffer !== buffer) {
      this.input = new Float32Array(buffer, this.inputPtr, SOUND_FRAME_LENGTH);
      this.output = new Float32Array(buffer, this.outputPtr, this.api.sc_output_len());
    }

    this.input.set(frame);
    if (frame.length < SOUND_FRAME_LENGTH) this.input.fill(0, frame.length);

    const start = performance.now();
    const code = this.api.sc_process();
    const processingMs = performance.now() - start;

    if (code === ERR_NON_FINITE) throw new RangeError('frame contains NaN or Infinity samples');
    if (code === ERR_NOT_INITIALISED) throw new Error('sound classifier is not initialised');

    const out = this.output;
    return {
      mfcc: out.slice(0, MFCC_COUNT),
      spectralCentroidHz: out[13],
      rmsDbfs: out[14],
      spectralFlatness: out[15],
      speechBandRatio: out[16],
      label: LABELS[code] ?? 'other',
      processingMs,
    };
  }

  /** Drops the wasm instance references so the memory can be garbage collected. */
  dispose(): void {
    this.disposed = true;
    this.input = new Float32Array(0);
    this.output = new Float32Array(0);
  }
}
