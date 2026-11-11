 feature/solana-optimistic-escrow-simulation
// AudioWorkletGlobalScope declaration
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

export class SpatialAudioWorkletProcessor extends AudioWorkletProcessor {
  private wasmInstance: any = null;
  private azimuth: number = 0;
  private elevation: number = 0;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data.type === "INIT_WASM") {
        this.wasmInstance = event.data.wasmModule;
      } else if (event.data.type === "UPDATE_ORIENTATION") {
        this.azimuth = event.data.azimuth ?? 0;
        this.elevation = event.data.elevation ?? 0;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || !output || !output[0] || !output[1]) {
      return true;
    }

    const inputChannel = input[0];
    const outputL = output[0];
    const outputR = output[1];

    if (this.wasmInstance && this.wasmInstance.convolve_spatial_frame) {
      // High-performance WASM SIMD execution path
      this.wasmInstance.convolve_spatial_frame(
        inputChannel,
        this.azimuth,
        this.elevation,
        outputL,
        outputR,
      );
    } else {
      // Graceful fallback to equal-power stereophonic panning
      const rad = (this.azimuth * Math.PI) / 180;
      const gainL = Math.cos(Math.PI / 4 - rad * 0.5);
      const gainR = Math.sin(Math.PI / 4 + rad * 0.5);

      for (let i = 0; i < inputChannel.length; i++) {
        outputL[i] = inputChannel[i] * gainL;
        outputR[i] = inputChannel[i] * gainR;
      }
    }


/**
 * AudioWorklet wrapper for the Rust/WASM SIMD spatial-audio kernel
 * (`src/wasm/spatial-audio`, #7490).
 *
 * On ARM64 mobile browsers, `v128.load` traps with
 * `RuntimeError: memory access out of bounds or unaligned SIMD load` when a
 * linear-memory byte offset is not 16-byte aligned. This wrapper therefore:
 *
 *   1. allocates every WASM linear-memory offset through
 *      `AlignedWasmAllocator`, which pads offsets (and sizes) to multiples
 *      of `SIMD_ALIGNMENT_BYTES` (16), matching `#[repr(align(16))]` on
 *      the Rust side;
 *   2. verifies the alignment contract of the loaded kernel at init time;
 *   3. falls back to scalar math (never silence) if the kernel ever throws,
 *      so an unaligned-SIMD trap cannot take down the audio graph.
 *
 * Load inside an AudioWorkletGlobalScope:
 *
 *   const wasm = await WebAssembly.instantiateStreaming(
 *     fetch("/wasm/spatial-audio.wasm"),
 *   );
 *   new AudioWorkletNode(ctx, SPATIAL_AUDIO_WORKLET_NAME, {
 *     processorOptions: { wasm },
 *   });
 *
 * The page may instead stash the exports on
 * `globalThis.__WORKSPHERE_SPATIAL_AUDIO_WASM__` before adding the module,
 * which keeps the worklet file itself fetch-free.
 */

export const SIMD_ALIGNMENT_BYTES = 16;

/** Result codes mirrored from `src/wasm/spatial-audio/src/lib.rs`. */
export const SPATIAL_DSP_OK = 0;
export const SPATIAL_DSP_FALLBACK_SCALAR = 1;
export const SPATIAL_DSP_ERR_INVALID = 2;

export const SPATIAL_AUDIO_WORKLET_NAME = "spatial-audio-wasm-processor";

/**
 * Round `offset` up to the next multiple of `alignment`, which must be a
 * positive power of two.
 */
export function alignTo(offset: number, alignment: number = SIMD_ALIGNMENT_BYTES): number {
  if (!Number.isInteger(alignment) || alignment <= 0 || (alignment & (alignment - 1)) !== 0) {
    throw new RangeError(`alignment must be a positive power of two, got ${alignment}`);
  }
  const mask = alignment - 1;
  return (offset + mask) & ~mask;
}

/** True when `offset` is a non-negative multiple of `alignment`. */
export function isAligned(offset: number, alignment: number = SIMD_ALIGNMENT_BYTES): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset % alignment === 0;
}

/** Constant-power panning (-1 = hard left, 0 = center, +1 = hard right). */
export function constantPowerGains(pan: number): { left: number; right: number } {
  const clamped = Math.min(1, Math.max(-1, pan));
  const angle = ((clamped + 1) * 0.5) * (Math.PI / 2);
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

/** Minimal surface of the compiled `spatial_audio` module. */
export interface SpatialAudioWasmExports {
  /** Shared linear memory backing every byte offset below. */
  memory: { buffer: ArrayBuffer };
  spatial_dsp_process(
    inPtr: number,
    outLPtr: number,
    outRPtr: number,
    numSamples: number,
    pan: number,
    gain: number,
  ): number;
  /** Optional contract check; kernels without it are assumed 16-byte. */
  spatial_dsp_alignment_bytes?(): number;
}

/** Anything exposing a linear memory buffer (e.g. `WebAssembly.Memory`). */
export interface LinearMemoryLike {
  buffer: ArrayBuffer;
}

/**
 * Bump allocator over WASM linear memory that hands out 16-byte aligned,
 * 16-byte padded offsets, so SIMD loads in the kernel can never trap on
 * ARM64 (#7490).
 */
export class AlignedWasmAllocator {
  private next: number;

  readonly start: number;

  constructor(
    private readonly memory: LinearMemoryLike,
    startOffset: number = 4096,
  ) {
    if (!isAligned(startOffset)) {
      throw new RangeError(
        `start offset must be ${SIMD_ALIGNMENT_BYTES}-byte aligned, got ${startOffset}`,
      );
    }
    this.start = startOffset;
    this.next = startOffset;
  }

  /** Current heap cursor (start of the next allocation). */
  get offset(): number {
    return this.next;
  }

  /** Reserve `bytes` and return a pointer aligned to `SIMD_ALIGNMENT_BYTES`. */
  alloc(bytes: number): number {
    if (!Number.isInteger(bytes) || bytes <= 0) {
      throw new RangeError(`allocation size must be a positive integer, got ${bytes}`);
    }
    const capacity = this.memory.buffer.byteLength;
    const padded = alignTo(bytes);
    if (this.next + padded > capacity) {
      throw new RangeError(
        `out of WASM linear memory: need ${padded} bytes at ${this.next}, capacity ${capacity}`,
      );
    }
    const ptr = this.next;
    this.next += padded;
    return ptr;
  }

  /** Rewind the heap cursor to the start offset. */
  reset(): void {
    this.next = this.start;
  }
}

/*
 * The AudioWorklet runtime (`AudioWorkletProcessor` / `registerProcessor`)
 * only exists inside an AudioWorkletGlobalScope; fall back to a no-op base
 * class so this module stays importable for unit tests and the page bundle.
 */
const workletGlobal = globalThis as any;
const AudioWorkletProcessorBase: any =
  typeof workletGlobal.AudioWorkletProcessor !== "undefined"
    ? workletGlobal.AudioWorkletProcessor
    : class {};

export interface SpatialAudioWorkletOptions {
  processorOptions?: {
    /** Compiled `spatial_audio` exports; falls back to scalar DSP if absent. */
    wasm?: SpatialAudioWasmExports;
    /** Initial pan (-1..1) and gain (>= 0). */
    pan?: number;
    gain?: number;
  };
}

export interface SpatialAudioWorkletStats {
  /** True while the WASM kernel is active (no fallback has fired). */
  wasmActive: boolean;
  /** Blocks handed to the WASM kernel. */
  wasmCalls: number;
  /** Blocks the kernel processed with its aligned SIMD path. */
  simdAlignedCalls: number;
  /** Blocks the kernel processed with its own scalar fallback. */
  kernelScalarFallbacks: number;
  /** Times a kernel trap forced the JS scalar fallback. */
  trapFallbacks: number;
}

interface AlignedBufferSet {
  inPtr: number;
  outLPtr: number;
  outRPtr: number;
  capacity: number;
  views: { in: Float32Array; outL: Float32Array; outR: Float32Array };
}

export class SpatialAudioWorkletProcessor extends AudioWorkletProcessorBase {
  private readonly initialPan: number;
  private readonly initialGain: number;
  private wasm: SpatialAudioWasmExports | null;
  private buffers: AlignedBufferSet | null = null;
  private scalarMode = false;
  private wasmCalls = 0;
  private simdAlignedCalls = 0;
  private kernelScalarFallbacks = 0;
  private trapFallbacks = 0;

  constructor(options: SpatialAudioWorkletOptions = {}) {
    super(options);
    const processorOptions = options.processorOptions ?? {};
    this.initialPan = processorOptions.pan ?? 0;
    this.initialGain = processorOptions.gain ?? 1;
    this.wasm = SpatialAudioWorkletProcessor.resolveWasm(processorOptions.wasm);
    if (this.wasm !== null && !this.checkAlignmentContract(this.wasm)) {
      // The kernel disagrees with our 16-byte allocator; stay scalar.
      this.wasm = null;
    }
    if (this.wasm !== null) {
      try {
        new AlignedWasmAllocator(this.wasm.memory);
      } catch {
        this.wasm = null;
      }
    }
  }

  /** Compiled kernel chosen from `processorOptions` or the page injection. */
  private static resolveWasm(explicit?: SpatialAudioWasmExports): SpatialAudioWasmExports | null {
    const injected = (workletGlobal.__WORKSPHERE_SPATIAL_AUDIO_WASM__ ??
      null) as SpatialAudioWasmExports | null;
    const candidate = explicit ?? injected;
    if (!candidate || typeof candidate.spatial_dsp_process !== "function") {
      return null;
    }
    return candidate;
  }

  /** Kernel and allocator must agree on the SIMD alignment boundary. */
  private checkAlignmentContract(wasm: SpatialAudioWasmExports): boolean {
    const reported = wasm.spatial_dsp_alignment_bytes?.();
    return reported === undefined || reported === SIMD_ALIGNMENT_BYTES;
  }

  /** Runtime diagnostics for the 10-minute ARM64/x86_64 soak (#7490). */
  getStats(): SpatialAudioWorkletStats {
    return {
      wasmActive: this.wasm !== null && !this.scalarMode,
      wasmCalls: this.wasmCalls,
      simdAlignedCalls: this.simdAlignedCalls,
      kernelScalarFallbacks: this.kernelScalarFallbacks,
      trapFallbacks: this.trapFallbacks,
    };
  }

  /**
   * (Re)allocate the in/out scratch buffers. Every offset comes from
   * `AlignedWasmAllocator`, so all three pointers handed to the kernel are
   * multiples of 16 — the exact contract `#[repr(align(16))]` enforces on
   * the Rust side (#7490). Memory growth replaces the ArrayBuffer, which
   * invalidates cached offsets and views, so we rebuild from scratch.
   */
  private ensureBuffers(wasm: SpatialAudioWasmExports, numSamples: number): AlignedBufferSet {
    const existing = this.buffers;
    const memoryGrew = existing !== null && existing.views.in.buffer !== wasm.memory.buffer;
    if (existing !== null && !memoryGrew && existing.capacity >= numSamples) {
      return existing;
    }

    const allocator = new AlignedWasmAllocator(wasm.memory);
    const bytes = numSamples * Float32Array.BYTES_PER_ELEMENT;
    const inPtr = allocator.alloc(bytes);
    const outLPtr = allocator.alloc(bytes);
    const outRPtr = allocator.alloc(bytes);
    // Defensive: an allocator that ever hands out an unaligned offset would
    // trap the kernel on ARM64 (#7490).
    if (!isAligned(inPtr) || !isAligned(outLPtr) || !isAligned(outRPtr)) {
      throw new RangeError("AlignedWasmAllocator handed out an unaligned offset");
    }
    const views = {
      in: new Float32Array(wasm.memory.buffer, inPtr, numSamples),
      outL: new Float32Array(wasm.memory.buffer, outLPtr, numSamples),
      outR: new Float32Array(wasm.memory.buffer, outRPtr, numSamples),
    };
    const buffers: AlignedBufferSet = { inPtr, outLPtr, outRPtr, capacity: numSamples, views };
    this.buffers = buffers;
    return buffers;
  }

  /** Read an AudioParam value with an initial-value fallback. */
  private readParam(parameters: Record<string, Float32Array>, name: string, fallback: number): number {
    const values = parameters[name];
    if (values !== undefined && values.length > 0 && Number.isFinite(values[0])) {
      return values[0];
    }
    return fallback;
  }

  /** Scalar fallback mirroring `pan_scalar` in the Rust kernel. */
  static panScalar(
    input: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    numSamples: number,
    pan: number,
    gain: number,
  ): void {
    const { left, right } = constantPowerGains(pan);
    const gainL = gain * left;
    const gainR = gain * right;
    for (let i = 0; i < numSamples; i += 1) {
      const sample = input[i];
      outL[i] = sample * gainL;
      outR[i] = sample * gainR;
    }
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const output = outputs[0];
    if (output === undefined || output.length === 0) {
      return true;
    }
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : outL;
    if (outL === undefined || outR === undefined) {
      return true;
    }

    const pan = this.readParam(parameters, "pan", this.initialPan);
    const gain = this.readParam(parameters, "gain", this.initialGain);

    const input = inputs[0];
    const inChannel = input === undefined ? undefined : input[0];
    if (inChannel === undefined || inChannel.length === 0) {
      // No source connected: emit silence but keep the node alive.
      outL.fill(0);
      if (outR !== outL) {
        outR.fill(0);
      }
      return true;
    }

    const numSamples = Math.min(inChannel.length, outL.length, outR.length);
    if (numSamples === 0) {
      return true;
    }

    if (this.wasm !== null && !this.scalarMode) {
      const wasm = this.wasm;
      try {
        const buffers = this.ensureBuffers(wasm, numSamples);
        buffers.views.in.set(inChannel.subarray(0, numSamples));
        const status = wasm.spatial_dsp_process(
          buffers.inPtr,
          buffers.outLPtr,
          buffers.outRPtr,
          numSamples,
          pan,
          gain,
        );
        this.wasmCalls += 1;
        if (status === SPATIAL_DSP_OK) {
          this.simdAlignedCalls += 1;
        } else if (status === SPATIAL_DSP_FALLBACK_SCALAR) {
          this.kernelScalarFallbacks += 1;
        } else {
          throw new RangeError(`spatial_dsp_process rejected the block (status ${status})`);
        }
        outL.set(buffers.views.outL.subarray(0, numSamples));
        if (outR !== outL) {
          outR.set(buffers.views.outR.subarray(0, numSamples));
        }
        return true;
      } catch {
        // #7490: an unaligned-SIMD trap (RuntimeError on ARM64) degrades to
        // scalar math for this and every following block — audio never dies.
        this.wasm = null;
        this.buffers = null;
        this.scalarMode = true;
        this.trapFallbacks += 1;
      }
    }

    SpatialAudioWorkletProcessor.panScalar(inChannel, outL, outR, numSamples, pan, gain);
 main
    return true;
  }
}

 feature/solana-optimistic-escrow-simulation
registerProcessor(
  "spatial-audio-worklet-processor",
  SpatialAudioWorkletProcessor,
);

if (typeof workletGlobal.registerProcessor === "function") {
  workletGlobal.registerProcessor(SPATIAL_AUDIO_WORKLET_NAME, SpatialAudioWorkletProcessor);
}
 main
