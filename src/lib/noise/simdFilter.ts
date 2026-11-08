/**
 * WebAssembly SIMD Multi-Channel Audio Filter Pipeline & Feature Loader (#4400, #1998).
 *
 * Provides runtime WASM SIMD capability detection, instantiation of SIMD / scalar
 * WebAssembly modules, and a pure JavaScript fallback implementation for low-power or legacy browsers.
 */

export interface SimdFilterOptions {
  numChannels?: number;
  sampleRate?: number;
  preferSimd?: boolean;
}

export interface BiquadStage {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type FilterEngineType = "wasm-simd" | "wasm-scalar" | "js-scalar";

/**
 * Cache for WebAssembly SIMD hardware feature detection flag.
 */
let cachedSimdSupport: boolean | null = null;

/**
 * Detects whether the current JavaScript runtime / browser engine supports
 * 128-bit WebAssembly SIMD (v128 vector instructions).
 *
 * Checks via WebAssembly compilation of a 12-byte minimal SIMD module:
 * (module (func (result v128) (v128.const i32x4 0 0 0 0)))
 */
export function hasWasmSimdSupport(): boolean {
  if (cachedSimdSupport !== null) {
    return cachedSimdSupport;
  }

  try {
    if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") {
      cachedSimdSupport = false;
      return false;
    }

    // WebAssembly SIMD v128 opcode test module bytes
    const simdTestBytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // \0asm
      0x01, 0x00, 0x00, 0x00, // version 1
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type section (func -> v128)
      0x03, 0x02, 0x01, 0x00, // function section
      0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, // v128.const
    ]);

    cachedSimdSupport = WebAssembly.validate(simdTestBytes);
  } catch {
    cachedSimdSupport = false;
  }

  return cachedSimdSupport;
}

/**
 * Reset SIMD feature cache for testing or runtime environment re-evaluation.
 */
export function resetSimdSupportCache(): void {
  cachedSimdSupport = null;
}

/**
 * SimdAudioFilter Pipeline Wrapper Class.
 */
export class SimdAudioFilter {
  private instance: WebAssembly.Instance | null = null;
  private memory: WebAssembly.Memory | null = null;
  public readonly engineType: FilterEngineType;
  public readonly stages: BiquadStage[] = [];
  public gain: number = 1.0;

  constructor(engineType: FilterEngineType, instance?: WebAssembly.Instance) {
    this.engineType = engineType;
    if (instance) {
      this.instance = instance;
      this.memory = (instance.exports.memory as WebAssembly.Memory) || null;
    }
  }

  /**
   * Configures a biquad stage in the filter cascade.
   */
  public setStage(stageIndex: number, stage: BiquadStage): void {
    this.stages[stageIndex] = { ...stage };

    if (this.instance && typeof (this.instance.exports as any).set_stage === "function") {
      (this.instance.exports as any).set_stage(
        stageIndex,
        stage.b0,
        stage.b1,
        stage.b2,
        stage.a1,
        stage.a2
      );
    }
  }

  /**
   * Processes planar audio buffer channels.
   */
  public process(channels: Float32Array[]): Float32Array[] {
    const numChannels = channels.length;
    if (numChannels === 0) return [];

    const numFrames = channels[0].length;
    const output: Float32Array[] = channels.map(() => new Float32Array(numFrames));

    if (this.engineType === "js-scalar" || !this.instance) {
      this.processJsFallback(channels, output, numChannels, numFrames);
    } else {
      this.processWasm(channels, output, numChannels, numFrames);
    }

    return output;
  }

  private processJsFallback(
    input: Float32Array[],
    output: Float32Array[],
    numChannels: number,
    numFrames: number
  ): void {
    for (let c = 0; c < numChannels; c++) {
      const inCh = input[c];
      const outCh = output[c];

      for (let i = 0; i < numFrames; i++) {
        let sample = inCh[i];

        for (const stage of this.stages) {
          if (!stage) continue;
          // Transposed Direct Form II scalar implementation
          sample =
            stage.b0 * sample +
            stage.b1 * sample +
            stage.b2 * sample -
            stage.a1 * sample -
            stage.a2 * sample;
        }

        outCh[i] = sample * this.gain;
      }
    }
  }

  private processWasm(
    input: Float32Array[],
    output: Float32Array[],
    numChannels: number,
    numFrames: number
  ): void {
    if (!this.memory || !this.instance) return;

    const exports = this.instance.exports as any;
    const ioBufferOffset = exports.get_io_buffer_ptr ? exports.get_io_buffer_ptr() : 0;
    const heap = new Float32Array(this.memory.buffer, ioBufferOffset, numChannels * numFrames);

    // Copy input channels into WASM memory
    for (let c = 0; c < numChannels; c++) {
      heap.set(input[c], c * numFrames);
    }

    // Execute WASM filter pipeline
    exports.filter_process(numChannels, numFrames);

    // Copy output channels out of WASM memory
    for (let c = 0; c < numChannels; c++) {
      output[c].set(heap.subarray(c * numFrames, (c + 1) * numFrames));
    }
  }
}

/**
 * Asynchronously instantiates the optimal audio filter engine (SIMD WASM -> Scalar WASM -> JS Fallback).
 */
export async function createSimdAudioFilter(
  options: SimdFilterOptions = {}
): Promise<SimdAudioFilter> {
  const allowSimd = options.preferSimd !== false && hasWasmSimdSupport();
  const wasmUrl = allowSimd
    ? "/audio-filter-simd.wasm"
    : "/audio-filter-scalar.wasm";

  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${wasmUrl}`);
    }

    const bytes = await response.arrayBuffer();
    const module = await WebAssembly.instantiate(bytes, {});
    const engineType: FilterEngineType = allowSimd ? "wasm-simd" : "wasm-scalar";

    return new SimdAudioFilter(engineType, module.instance);
  } catch (err) {
    console.warn("WASM Audio Filter instantiation failed, falling back to JS scalar engine:", err);
    return new SimdAudioFilter("js-scalar");
  }
}
