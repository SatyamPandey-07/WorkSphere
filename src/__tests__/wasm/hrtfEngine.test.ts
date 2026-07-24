import { describe, it, expect, beforeEach } from "@jest/globals";

// Mock WebAssembly HRTF engine JS wrapper interface mirroring exports
interface MockHrtfWasmModule {
  malloc_scratch_buffer: (size: number) => number;
  free_scratch_buffer: (ptr: number) => void;
  set_hrtf_simd_enabled: (enabled: number) => void;
  process_hrtf_block: (
    inputPtr: number,
    leftPtr: number,
    rightPtr: number,
    numSamples: number,
    azimuth: number,
    elevation: number,
    distance: number,
  ) => number;
  HEAPF32: Float32Array;
}

function createMockHrtfEngine(): MockHrtfWasmModule {
  const memoryBuffer = new ArrayBuffer(64 * 1024 * 1024); // 64MB WASM memory simulation
  const floatView = new Float32Array(memoryBuffer);
  let nextHeapOffset = 1024;
  let _simdEnabled = 1;

  return {
    HEAPF32: floatView,
    malloc_scratch_buffer: (sizeBytes: number) => {
      if (sizeBytes <= 0) return 0;
      // Ensure 16-byte alignment (4 float elements)
      const floatCount = Math.ceil(sizeBytes / 4);
      const alignedFloatOffset = Math.ceil(nextHeapOffset / 4) * 4;
      nextHeapOffset = alignedFloatOffset + floatCount;
      return alignedFloatOffset * 4; // return byte offset
    },
    free_scratch_buffer: (_ptr: number) => {
      // Mock deallocation
    },
    set_hrtf_simd_enabled: (enabled: number) => {
      _simdEnabled = enabled ? 1 : 0;
    },
    process_hrtf_block: (
      inputPtr: number,
      leftPtr: number,
      rightPtr: number,
      numSamples: number,
      azimuth: number,
      _elevation: number,
      distance: number,
    ) => {
      if (inputPtr <= 0 || leftPtr <= 0 || rightPtr <= 0 || numSamples <= 0) {
        return -1;
      }

      const inIdx = inputPtr / 4;
      const leftIdx = leftPtr / 4;
      const rightIdx = rightPtr / 4;

      const refDist = 1.0;
      const safeDist = Math.max(refDist, distance);
      const distGain = refDist / safeDist;

      const azRad = azimuth * (Math.PI / 180.0);
      const ildLeft = 0.5 * (1.0 - Math.sin(azRad));
      const ildRight = 0.5 * (1.0 + Math.sin(azRad));

      for (let i = 0; i < numSamples; i++) {
        const sample = floatView[inIdx + i];
        floatView[leftIdx + i] = sample * ildLeft * distGain;
        floatView[rightIdx + i] = sample * ildRight * distGain;
      }

      return 0;
    },
  };
}

describe("HRTF WebAssembly Engine Specification & Interface Tests", () => {
  let wasmModule: MockHrtfWasmModule;

  beforeEach(() => {
    wasmModule = createMockHrtfEngine();
  });

  it("allocates 16-byte aligned scratch memory buffers on WASM heap", () => {
    const bufferSize = 256 * 4; // 256 Float32 samples = 1024 bytes
    const ptr = wasmModule.malloc_scratch_buffer(bufferSize);

    expect(ptr).toBeGreaterThan(0);
    expect(ptr % 16).toBe(0); // 16-byte alignment check
  });

  it("processes HRTF audio blocks with correct distance gain attenuation", () => {
    const numSamples = 128;
    const inputPtr = wasmModule.malloc_scratch_buffer(numSamples * 4);
    const leftPtr = wasmModule.malloc_scratch_buffer(numSamples * 4);
    const rightPtr = wasmModule.malloc_scratch_buffer(numSamples * 4);

    const inIdx = inputPtr / 4;
    for (let i = 0; i < numSamples; i++) {
      wasmModule.HEAPF32[inIdx + i] = 1.0; // Constant DC signal
    }

    // Distance = 2.0m -> Gain should be 1/2 = 0.5
    const status = wasmModule.process_hrtf_block(
      inputPtr,
      leftPtr,
      rightPtr,
      numSamples,
      0, // 0 deg center azimuth
      0,
      2.0,
    );

    expect(status).toBe(0);

    const leftIdx = leftPtr / 4;
    const rightIdx = rightPtr / 4;

    // Center azimuth (0 deg) -> ILD left = 0.5, ILD right = 0.5
    // Output = 1.0 * 0.5 (ILD) * 0.5 (Distance) = 0.25
    expect(wasmModule.HEAPF32[leftIdx]).toBeCloseTo(0.25, 4);
    expect(wasmModule.HEAPF32[rightIdx]).toBeCloseTo(0.25, 4);
  });

  it("applies Interaural Level Difference (ILD) panning based on azimuth angle", () => {
    const numSamples = 64;
    const inputPtr = wasmModule.malloc_scratch_buffer(numSamples * 4);
    const leftPtr = wasmModule.malloc_scratch_buffer(numSamples * 4);
    const rightPtr = wasmModule.malloc_scratch_buffer(numSamples * 4);

    const inIdx = inputPtr / 4;
    for (let i = 0; i < numSamples; i++) {
      wasmModule.HEAPF32[inIdx + i] = 1.0;
    }

    // Azimuth = +90 deg (full right)
    wasmModule.process_hrtf_block(
      inputPtr,
      leftPtr,
      rightPtr,
      numSamples,
      90, // +90 deg right
      0,
      1.0,
    );

    const leftIdx = leftPtr / 4;
    const rightIdx = rightPtr / 4;

    // Right ear should receive full gain, left ear should be near zero
    expect(wasmModule.HEAPF32[rightIdx]).toBeCloseTo(1.0, 4);
    expect(wasmModule.HEAPF32[leftIdx]).toBeCloseTo(0.0, 4);
  });

  it("handles invalid pointers or negative sample counts gracefully", () => {
    const status = wasmModule.process_hrtf_block(
      0, // invalid null pointer
      100,
      200,
      128,
      0,
      0,
      1.0,
    );

    expect(status).toBe(-1);
  });

  it("supports SIMD runtime toggle", () => {
    expect(() => {
      wasmModule.set_hrtf_simd_enabled(0);
      wasmModule.set_hrtf_simd_enabled(1);
    }).not.toThrow();
  });
});
