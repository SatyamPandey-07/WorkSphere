import { describe, it, expect, beforeEach } from "@jest/globals";

// Mock WebAssembly HRTF engine JS wrapper interface mirroring exports
interface MockHrtfWasmModule {
  malloc_scratch_buffer: (size: number) => number;
  free_scratch_buffer: (ptr: number) => void;
  set_hrtf_simd_enabled: (enabled: number) => void;
  set_room_parameters: (
    width: number,
    length: number,
    height: number,
    absorption: number,
  ) => void;
  get_room_parameters: () => {
    width: number;
    length: number;
    height: number;
    absorption: number;
  };
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

  const roomParams = {
    width: 10.0,
    length: 12.0,
    height: 3.0,
    absorption: 0.2,
  };

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
    set_room_parameters: (w: number, l: number, h: number, a: number) => {
      if (w > 0) roomParams.width = w;
      if (l > 0) roomParams.length = l;
      if (h > 0) roomParams.height = h;
      if (a >= 0 && a <= 1.0) roomParams.absorption = a;
    },
    get_room_parameters: () => ({ ...roomParams }),
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

      const reverbMix = (1.0 - roomParams.absorption) * 0.25;

      for (let i = 0; i < numSamples; i++) {
        const sample = floatView[inIdx + i];
        // Direct spatial path + FDN reverb tail simulation
        const directL = sample * ildLeft * distGain;
        const directR = sample * ildRight * distGain;
        const fdnReverb = sample * reverbMix * 0.1;

        floatView[leftIdx + i] = directL + fdnReverb;
        floatView[rightIdx + i] = directR + fdnReverb;
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
    // Direct output = 1.0 * 0.5 (ILD) * 0.5 (Distance) = 0.25 + FDN reverb
    expect(wasmModule.HEAPF32[leftIdx]).toBeGreaterThan(0.25);
    expect(wasmModule.HEAPF32[rightIdx]).toBeGreaterThan(0.25);
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

    // Right ear should receive significantly higher gain than left ear
    expect(wasmModule.HEAPF32[rightIdx]).toBeGreaterThan(
      wasmModule.HEAPF32[leftIdx],
    );
  });

  it("exposes room dimensions and absorption parameters via set_room_parameters", () => {
    wasmModule.set_room_parameters(15.0, 20.0, 4.0, 0.35);
    const params = wasmModule.get_room_parameters();

    expect(params.width).toBe(15.0);
    expect(params.length).toBe(20.0);
    expect(params.height).toBe(4.0);
    expect(params.absorption).toBe(0.35);
  });

  it("maintains realtime performance processing 64-sample audio frames under 1ms", () => {
    const numSamples = 64;
    const inputPtr = wasmModule.malloc_scratch_buffer(numSamples * 4);
    const leftPtr = wasmModule.malloc_scratch_buffer(numSamples * 4);
    const rightPtr = wasmModule.malloc_scratch_buffer(numSamples * 4);

    const inIdx = inputPtr / 4;
    for (let i = 0; i < numSamples; i++) {
      wasmModule.HEAPF32[inIdx + i] = Math.sin(i * 0.1);
    }

    const iterations = 1000;
    const startTime = performance.now();
    for (let i = 0; i < iterations; i++) {
      wasmModule.process_hrtf_block(
        inputPtr,
        leftPtr,
        rightPtr,
        numSamples,
        45,
        0,
        2.5,
      );
    }
    const elapsedMs = performance.now() - startTime;
    const avgFrameMs = elapsedMs / iterations;

    expect(avgFrameMs).toBeLessThan(1.0);
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
