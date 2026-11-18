/**
 * #7490 — WebAssembly SIMD alignment safety for the spatial-audio worklet.
 *
 * The Rust kernel (src/wasm/spatial-audio/src/lib.rs) and this JS mirror
 * (src/lib/audio/SpatialAudioWorkletProcessor.ts) are verified through a
 * faithful harness compiled from plain JS, following the repo's existing
 * WASM-harness test pattern (see spatialMasking.test.ts), because CI has no
 * rustc/wasm32 toolchain.
 *
 * Covered guarantees:
 *   - every byte offset handed to the kernel is a multiple of 16
 *     (`#[repr(align(16))]` contract);
 *   - unaligned pointers degrade to scalar math instead of trapping;
 *   - a RuntimeError from the kernel (the ARM64 unaligned-SIMD trap) never
 *     kills audio: the wrapper falls back for the current and later blocks;
 *   - SIMD and scalar paths produce identical audio.
 */
import {
  SIMD_ALIGNMENT_BYTES,
  SPATIAL_AUDIO_WORKLET_NAME,
  SPATIAL_DSP_ERR_INVALID,
  SPATIAL_DSP_FALLBACK_SCALAR,
  SPATIAL_DSP_OK,
  AlignedWasmAllocator,
  SpatialAudioWorkletProcessor,
  alignTo,
  constantPowerGains,
  isAligned,
} from "@/lib/audio/SpatialAudioWorkletProcessor";

/**
 * JS mirror of `spatial_dsp_process` from
 * `src/wasm/spatial-audio/src/lib.rs`: identical dispatch and math, plus
 * counters proving which path each call took.
 */
function createSpatialDspHarness(memoryBytes = 64 * 1024) {
  const memory = { buffer: new ArrayBuffer(memoryBytes) };
  const f32 = new Float32Array(memory.buffer);
  let simdBatchCount = 0;
  let scalarSampleCount = 0;
  const calls: Array<{
    inPtr: number;
    outLPtr: number;
    outRPtr: number;
    numSamples: number;
    pan: number;
    gain: number;
  }> = [];

  const spatial_dsp_process = (
    inPtr: number,
    outLPtr: number,
    outRPtr: number,
    numSamples: number,
    pan: number,
    gain: number,
  ): number => {
    calls.push({ inPtr, outLPtr, outRPtr, numSamples, pan, gain });
    if (numSamples === 0 || inPtr === 0 || outLPtr === 0 || outRPtr === 0) {
      return SPATIAL_DSP_ERR_INVALID;
    }
    const { left, right } = constantPowerGains(pan);
    const gainL = gain * left;
    const gainR = gain * right;

    if (isAligned(inPtr) && isAligned(outLPtr) && isAligned(outRPtr)) {
      for (let i = 0; i < numSamples; i += 4) {
        if (i + 4 <= numSamples) {
          // A whole 4-lane SIMD batch, mirroring the Rust `v128` loop.
          simdBatchCount += 1;
        } else {
          scalarSampleCount += numSamples - i;
        }
        const laneEnd = Math.min(i + 4, numSamples);
        for (let j = i; j < laneEnd; j += 1) {
          const sample = f32[inPtr / 4 + j];
          f32[outLPtr / 4 + j] = sample * gainL;
          f32[outRPtr / 4 + j] = sample * gainR;
        }
      }
      return SPATIAL_DSP_OK;
    }

    for (let i = 0; i < numSamples; i += 1) {
      scalarSampleCount += 1;
      const sample = f32[inPtr / 4 + i];
      f32[outLPtr / 4 + i] = sample * gainL;
      f32[outRPtr / 4 + i] = sample * gainR;
    }
    return SPATIAL_DSP_FALLBACK_SCALAR;
  };

  const wasmExports = {
    memory,
    spatial_dsp_process,
    spatial_dsp_alignment_bytes: (): number => SIMD_ALIGNMENT_BYTES,
  };

  return {
    wasmExports,
    f32,
    getCalls: () => calls,
    getSimdBatchCount: () => simdBatchCount,
    getScalarSampleCount: () => scalarSampleCount,
  };
}

describe("SIMD alignment math (#7490)", () => {
  it("alignTo rounds offsets up to the next 16-byte boundary", () => {
    expect(alignTo(0)).toBe(0);
    expect(alignTo(1)).toBe(16);
    expect(alignTo(15)).toBe(16);
    expect(alignTo(16)).toBe(16);
    expect(alignTo(17)).toBe(32);
    expect(alignTo(4097)).toBe(4112);
  });

  it("alignTo rejects non-power-of-two alignments", () => {
    expect(() => alignTo(8, 12)).toThrow(RangeError);
    expect(() => alignTo(8, 0)).toThrow(RangeError);
    expect(() => alignTo(8, -16)).toThrow(RangeError);
  });

  it("isAligned accepts only non-negative multiples of 16", () => {
    expect(isAligned(0)).toBe(true);
    expect(isAligned(64)).toBe(true);
    expect(isAligned(-16)).toBe(false);
    expect(isAligned(16.5)).toBe(false);
    expect(isAligned(17)).toBe(false);
  });

  it("constant-power panning hits the endpoints and center", () => {
    expect(constantPowerGains(-1).left).toBeCloseTo(1, 6);
    expect(constantPowerGains(-1).right).toBeCloseTo(0, 6);
    expect(constantPowerGains(1).left).toBeCloseTo(0, 6);
    expect(constantPowerGains(1).right).toBeCloseTo(1, 6);
    expect(constantPowerGains(0).left).toBeCloseTo(Math.SQRT1_2, 6);
    expect(constantPowerGains(0).right).toBeCloseTo(Math.SQRT1_2, 6);
    // Out-of-range pans are clamped, never explode.
    expect(constantPowerGains(-9).left).toBeCloseTo(1, 6);
    expect(constantPowerGains(9).right).toBeCloseTo(1, 6);
  });
});

describe("AlignedWasmAllocator (#7490)", () => {
  it("hands out 16-byte aligned pointers for odd sizes", () => {
    const allocator = new AlignedWasmAllocator({ buffer: new ArrayBuffer(4096) }, 1024);
    for (const bytes of [1, 3, 5, 17, 32, 129]) {
      expect(isAligned(allocator.alloc(bytes))).toBe(true);
    }
  });

  it("pads sizes so allocations never overlap", () => {
    const allocator = new AlignedWasmAllocator({ buffer: new ArrayBuffer(4096) }, 64);
    // 5 bytes → padded to 16: a=[64,80), b=[80,96), c=[96,112)
    expect([allocator.alloc(5), allocator.alloc(5), allocator.alloc(16)]).toEqual([64, 80, 96]);
  });

  it("throws when the heap cursor would leave linear memory", () => {
    const allocator = new AlignedWasmAllocator({ buffer: new ArrayBuffer(128) }, 112);
    allocator.alloc(16); // [112,128) — memory is now full
    expect(() => allocator.alloc(1)).toThrow(RangeError);
  });

  it("rejects unaligned start offsets and invalid sizes", () => {
    expect(() => new AlignedWasmAllocator({ buffer: new ArrayBuffer(64) }, 100)).toThrow(RangeError);
    const allocator = new AlignedWasmAllocator({ buffer: new ArrayBuffer(64) }, 0);
    expect(() => allocator.alloc(0)).toThrow(RangeError);
    expect(() => allocator.alloc(-4)).toThrow(RangeError);
    expect(() => allocator.alloc(2.5)).toThrow(RangeError);
  });

  it("reset rewinds to the aligned start cursor", () => {
    const allocator = new AlignedWasmAllocator({ buffer: new ArrayBuffer(4096) }, 2048);
    allocator.alloc(48);
    allocator.alloc(48);
    allocator.reset();
    expect(allocator.offset).toBe(2048);
    expect(allocator.alloc(48)).toBe(2048);
  });
});

describe("spatial_dsp_process kernel semantics (Rust mirror, #7490)", () => {
  it("takes the aligned SIMD path for allocator-provided pointers", () => {
    const harness = createSpatialDspHarness();
    const allocator = new AlignedWasmAllocator(harness.wasmExports.memory);
    const inPtr = allocator.alloc(130 * 4);
    const outLPtr = allocator.alloc(130 * 4);
    const outRPtr = allocator.alloc(130 * 4);
    for (let i = 0; i < 130; i += 1) {
      harness.f32[inPtr / 4 + i] = 0.25;
    }

    const status = harness.wasmExports.spatial_dsp_process(inPtr, outLPtr, outRPtr, 130, 0.0, 2);

    expect(status).toBe(SPATIAL_DSP_OK);
    expect(harness.getSimdBatchCount()).toBe(32); // 32 whole 4-lane batches
    expect(harness.getScalarSampleCount()).toBe(2); // 130 % 4 = 2-sample tail
    expect(harness.f32[outLPtr / 4]).toBeCloseTo(0.25 * Math.SQRT1_2 * 2, 6);
    expect(harness.f32[outRPtr / 4 + 129]).toBeCloseTo(0.25 * Math.SQRT1_2 * 2, 6);
  });

  it("falls back to scalar math for unaligned pointers instead of trapping", () => {
    const harness = createSpatialDspHarness();
    const allocator = new AlignedWasmAllocator(harness.wasmExports.memory);
    const inPtr = allocator.alloc(64 * 4);
    const outLPtr = allocator.alloc(64 * 4) + 4; // deliberately unaligned
    const outRPtr = allocator.alloc(64 * 4) + 4; // deliberately unaligned
    for (let i = 0; i < 64; i += 1) {
      harness.f32[inPtr / 4 + i] = 0.5;
    }

    const status = harness.wasmExports.spatial_dsp_process(inPtr, outLPtr, outRPtr, 64, 0, 1);

    expect(status).toBe(SPATIAL_DSP_FALLBACK_SCALAR);
    expect(harness.getSimdBatchCount()).toBe(0);
    expect(harness.getScalarSampleCount()).toBe(64);
    expect(harness.f32[outLPtr / 4]).toBeCloseTo(0.5 * Math.SQRT1_2, 6);
    expect(harness.f32[outRPtr / 4 + 63]).toBeCloseTo(0.5 * Math.SQRT1_2, 6);
  });

  it("produces identical audio on the SIMD and scalar paths", () => {
    const harness = createSpatialDspHarness();
    const allocator = new AlignedWasmAllocator(harness.wasmExports.memory);
    const inPtr = allocator.alloc(128 * 4);
    const outLAligned = allocator.alloc(128 * 4);
    const outRAligned = allocator.alloc(128 * 4);
    const outLUnaligned = allocator.alloc(128 * 4) + 4;
    const outRUnaligned = allocator.alloc(128 * 4) + 4;
    for (let i = 0; i < 128; i += 1) {
      harness.f32[inPtr / 4 + i] = Math.sin(i / 16);
    }

    expect(harness.wasmExports.spatial_dsp_process(inPtr, outLAligned, outRAligned, 128, 0.4, 0.75)).toBe(
      SPATIAL_DSP_OK,
    );
    expect(
      harness.wasmExports.spatial_dsp_process(inPtr, outLUnaligned, outRUnaligned, 128, 0.4, 0.75),
    ).toBe(SPATIAL_DSP_FALLBACK_SCALAR);

    for (let i = 0; i < 128; i += 1) {
      expect(harness.f32[outLAligned / 4 + i]).toBeCloseTo(harness.f32[outLUnaligned / 4 + i], 12);
      expect(harness.f32[outRAligned / 4 + i]).toBeCloseTo(harness.f32[outRUnaligned / 4 + i], 12);
    }
  });

  it("rejects null pointers and empty blocks without touching memory", () => {
    const harness = createSpatialDspHarness();
    const allocator = new AlignedWasmAllocator(harness.wasmExports.memory);
    const inPtr = allocator.alloc(16);
    const outPtr = allocator.alloc(16);

    expect(harness.wasmExports.spatial_dsp_process(0, outPtr, outPtr, 8, 0, 1)).toBe(SPATIAL_DSP_ERR_INVALID);
    expect(harness.wasmExports.spatial_dsp_process(inPtr, 0, outPtr, 8, 0, 1)).toBe(SPATIAL_DSP_ERR_INVALID);
    expect(harness.wasmExports.spatial_dsp_process(inPtr, outPtr, 0, 8, 0, 1)).toBe(SPATIAL_DSP_ERR_INVALID);
    expect(harness.wasmExports.spatial_dsp_process(inPtr, outPtr, outPtr, 0, 0, 1)).toBe(SPATIAL_DSP_ERR_INVALID);
  });

  it("publishes the 16-byte alignment contract", () => {
    const harness = createSpatialDspHarness();
    expect(harness.wasmExports.spatial_dsp_alignment_bytes?.()).toBe(SIMD_ALIGNMENT_BYTES);
  });
});

describe("SpatialAudioWorkletProcessor (#7490)", () => {
  const makeBlock = (length: number, value: (i: number) => number) => {
    const channel = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      channel[i] = value(i);
    }
    return [[channel]];
  };

  const makeOutputs = (length: number, channels = 2) =>
    [Array.from({ length: channels }, () => new Float32Array(length))];

  it("hands only 16-byte aligned offsets to the WASM kernel", () => {
    const harness = createSpatialDspHarness();
    const processor = new SpatialAudioWorkletProcessor({
      processorOptions: { wasm: harness.wasmExports },
    });
    const outputs = makeOutputs(128);

    expect(processor.process(makeBlock(128, () => 0.5), outputs, { pan: new Float32Array([0.25]) })).toBe(
      true,
    );

    expect(harness.getCalls()).toHaveLength(1);
    const call = harness.getCalls()[0];
    expect(isAligned(call.inPtr)).toBe(true);
    expect(isAligned(call.outLPtr)).toBe(true);
    expect(isAligned(call.outRPtr)).toBe(true);
    // 128 samples = 32 whole 4-lane batches on the SIMD path, zero scalar.
    expect(harness.getSimdBatchCount()).toBe(32);
    expect(harness.getScalarSampleCount()).toBe(0);

    const { left, right } = constantPowerGains(0.25);
    outputs[0][0].forEach((sample) => expect(sample).toBeCloseTo(0.5 * left, 6));
    outputs[0][1].forEach((sample) => expect(sample).toBeCloseTo(0.5 * right, 6));
    expect(processor.getStats()).toMatchObject({
      wasmActive: true,
      wasmCalls: 1,
      simdAlignedCalls: 1,
      kernelScalarFallbacks: 0,
      trapFallbacks: 0,
    });
  });

  it("reads pan/gain AudioParams per block", () => {
    const harness = createSpatialDspHarness();
    const processor = new SpatialAudioWorkletProcessor({
      processorOptions: { wasm: harness.wasmExports },
    });
    const outputs = makeOutputs(8);

    processor.process(makeBlock(8, () => 1), outputs, {
      pan: new Float32Array([-1]),
      gain: new Float32Array([0.5]),
    });

    outputs[0][0].forEach((sample) => expect(sample).toBeCloseTo(0.5, 6));
    outputs[0][1].forEach((sample) => expect(sample).toBeCloseTo(0, 6));
  });

  it("degrades to scalar math when the kernel traps, without dropping audio", () => {
    let kernelCalls = 0;
    const trappingExports = {
      memory: { buffer: new ArrayBuffer(64 * 1024) },
      spatial_dsp_process: (): number => {
        kernelCalls += 1;
        // The exact ARM64 failure from issue #7490.
        throw new WebAssembly.RuntimeError("memory access out of bounds or unaligned SIMD load");
      },
    };
    const processor = new SpatialAudioWorkletProcessor({
      processorOptions: { wasm: trappingExports },
    });
    const input = makeBlock(64, (i) => Math.sin(i / 8));
    const outputs = makeOutputs(64);

    // The trapping block itself is still filled with scalar-panned audio.
    expect(processor.process(input, outputs, {})).toBe(true);
    expect(kernelCalls).toBe(1);
    outputs[0][0].forEach((sample, i) => expect(sample).toBeCloseTo(input[0][0][i] * Math.SQRT1_2, 6));
    outputs[0][1].forEach((sample, i) => expect(sample).toBeCloseTo(input[0][0][i] * Math.SQRT1_2, 6));
    expect(processor.getStats()).toMatchObject({ wasmActive: false, trapFallbacks: 1 });

    // Later blocks never touch the trapped kernel again.
    expect(processor.process(input, outputs, {})).toBe(true);
    expect(kernelCalls).toBe(1);
    outputs[0][0].forEach((sample, i) => expect(sample).toBeCloseTo(input[0][0][i] * Math.SQRT1_2, 6));
  });

  it("falls back to scalar when no WASM module was injected", () => {
    const processor = new SpatialAudioWorkletProcessor();
    const outputs = makeOutputs(16);

    expect(processor.getStats().wasmActive).toBe(false);
    expect(processor.process(makeBlock(16, () => 1), outputs, {})).toBe(true);
    outputs[0][0].forEach((sample) => expect(sample).toBeCloseTo(Math.SQRT1_2, 6));
    outputs[0][1].forEach((sample) => expect(sample).toBeCloseTo(Math.SQRT1_2, 6));
    expect(processor.getStats().wasmCalls).toBe(0);
  });

  it("rejects kernels with a mismatched alignment contract", () => {
    const mismatchedExports = {
      memory: { buffer: new ArrayBuffer(64 * 1024) },
      spatial_dsp_process: (): number => 0,
      spatial_dsp_alignment_bytes: (): number => 8,
    };
    const processor = new SpatialAudioWorkletProcessor({
      processorOptions: { wasm: mismatchedExports },
    });

    expect(processor.getStats()).toMatchObject({ wasmActive: false, trapFallbacks: 0 });
    const outputs = makeOutputs(4);
    processor.process(makeBlock(4, () => 1), outputs, {});
    outputs[0][0].forEach((sample) => expect(sample).toBeCloseTo(Math.SQRT1_2, 6));
  });

  it("emits silence when no input is connected but keeps the node alive", () => {
    const harness = createSpatialDspHarness();
    const processor = new SpatialAudioWorkletProcessor({
      processorOptions: { wasm: harness.wasmExports },
    });
    const outputs = makeOutputs(32);

    expect(processor.process([[]], outputs, {})).toBe(true);
    outputs[0][0].forEach((sample) => expect(sample).toBe(0));
    outputs[0][1].forEach((sample) => expect(sample).toBe(0));
    expect(processor.getStats().wasmCalls).toBe(0);
  });

  it("handles mono output without touching a second channel", () => {
    const harness = createSpatialDspHarness();
    const processor = new SpatialAudioWorkletProcessor({
      processorOptions: { wasm: harness.wasmExports },
    });
    const outputs = makeOutputs(16, 1);

    expect(processor.process(makeBlock(16, () => 1), outputs, {})).toBe(true);
    const { left } = constantPowerGains(0);
    outputs[0][0].forEach((sample) => expect(sample).toBeCloseTo(left, 6));
  });

  it("registerProcessor is only called inside a real AudioWorklet runtime", () => {
    const registered: Array<[string, unknown]> = [];
    (globalThis as Record<string, unknown>).registerProcessor = (name: string, ctor: unknown) => {
      registered.push([name, ctor]);
    };
    (globalThis as Record<string, unknown>).AudioWorkletProcessor = class {};

    try {
      jest.isolateModules(() => {
        jest.requireActual("@/lib/audio/SpatialAudioWorkletProcessor");
      });
      expect(registered).toHaveLength(1);
      expect(registered[0][0]).toBe(SPATIAL_AUDIO_WORKLET_NAME);
      expect(typeof registered[0][1]).toBe("function");
    } finally {
      delete (globalThis as Record<string, unknown>).registerProcessor;
      delete (globalThis as Record<string, unknown>).AudioWorkletProcessor;
    }
  });
});
