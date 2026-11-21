/**
 * @file RadixSortCompute.test.ts
 * @jest-environment node
 */

import {
  RadixSortCompute,
  floatToRadixKey,
  radixKeyToFloat,
  blellochScanExclusive,
  getRadixSortWGSL,
  isWebGPUSupported,
  RADIX_PASSES,
} from "../RadixSortCompute";

describe("RadixSortCompute - Float Key Transformation", () => {
  it("preserves ascending order for positive numbers", () => {
    const k1 = floatToRadixKey(1.0);
    const k2 = floatToRadixKey(2.5);
    const k3 = floatToRadixKey(100.0);
    expect(k1).toBeLessThan(k2);
    expect(k2).toBeLessThan(k3);
  });

  it("preserves ascending order for negative numbers", () => {
    const k1 = floatToRadixKey(-100.0);
    const k2 = floatToRadixKey(-2.5);
    const k3 = floatToRadixKey(-1.0);
    expect(k1).toBeLessThan(k2);
    expect(k2).toBeLessThan(k3);
  });

  it("orders negative numbers before positive numbers", () => {
    const kNeg = floatToRadixKey(-0.001);
    const kPos = floatToRadixKey(0.001);
    expect(kNeg).toBeLessThan(kPos);
  });

  it("correctly handles positive and negative zero stably", () => {
    const kNegZero = floatToRadixKey(-0.0);
    const kPosZero = floatToRadixKey(+0.0);
    // -0.0 maps to 0x7FFFFFFF, +0.0 maps to 0x80000000
    expect(kNegZero).toBeLessThanOrEqual(kPosZero);
    expect(radixKeyToFloat(kNegZero)).toBeCloseTo(0.0);
    expect(radixKeyToFloat(kPosZero)).toBeCloseTo(0.0);
  });

  it("handles infinity and NaN deterministically", () => {
    const kNegInf = floatToRadixKey(-Infinity);
    const kPosInf = floatToRadixKey(Infinity);
    const kNaN = floatToRadixKey(NaN);

    expect(kNegInf).toBeLessThan(floatToRadixKey(-1000000));
    expect(kPosInf).toBeGreaterThan(floatToRadixKey(1000000));
    expect(kNegInf).toBe(0x007fffff);
    expect(kPosInf).toBe(0xff800000);
    expect(kNaN).toBe(0xffffffff);
  });

  it("round-trips float transformation accurately", () => {
    const testValues = [-1234.5, -42.0, -0.0001, 0.0, 0.0001, 15.75, 99999.5];
    for (const val of testValues) {
      const key = floatToRadixKey(val);
      const restored = radixKeyToFloat(key);
      expect(restored).toBeCloseTo(val, 4);
    }
  });
});

describe("RadixSortCompute - Blelloch Prefix Sum", () => {
  it("computes exclusive prefix scan on power-of-two array", () => {
    const input = new Uint32Array([3, 1, 7, 0, 4, 1, 6, 3]);
    const scanned = blellochScanExclusive(input);
    expect(Array.from(scanned)).toEqual([0, 3, 4, 11, 11, 15, 16, 22]);
  });

  it("computes exclusive prefix scan on non-power-of-two array", () => {
    const input = new Uint32Array([2, 5, 1, 3, 4]);
    const scanned = blellochScanExclusive(input);
    expect(Array.from(scanned)).toEqual([0, 2, 7, 8, 11]);
  });

  it("handles single-element and empty arrays", () => {
    expect(Array.from(blellochScanExclusive(new Uint32Array([])))).toEqual([]);
    expect(Array.from(blellochScanExclusive(new Uint32Array([42])))).toEqual([0]);
  });
});

describe("RadixSortCompute - Functional Requirements & Sorting Correctness", () => {
  let sorter: RadixSortCompute;

  beforeEach(() => {
    sorter = new RadixSortCompute(null); // CPU fallback
  });

  it("1. handles empty input", async () => {
    const res = await sorter.sort([]);
    expect(res.count).toBe(0);
    expect(res.depths.length).toBe(0);
    expect(res.indices.length).toBe(0);
  });

  it("2. handles single-element input", async () => {
    const res = await sorter.sort([42.5], [7]);
    expect(res.count).toBe(1);
    expect(res.depths[0]).toBeCloseTo(42.5);
    expect(res.indices[0]).toBe(7);
  });

  it("3. handles already sorted input", async () => {
    const depths = [1.0, 2.0, 3.0, 4.0, 5.0];
    const res = await sorter.sort(depths);
    expect(Array.from(res.depths)).toEqual(depths);
    expect(Array.from(res.indices)).toEqual([0, 1, 2, 3, 4]);
  });

  it("4. handles reverse-sorted input", async () => {
    const depths = [5.0, 4.0, 3.0, 2.0, 1.0];
    const indices = [10, 20, 30, 40, 50];
    const res = await sorter.sort(depths, indices);
    expect(Array.from(res.depths)).toEqual([1.0, 2.0, 3.0, 4.0, 5.0]);
    expect(Array.from(res.indices)).toEqual([50, 40, 30, 20, 10]);
  });

  it("5. sorts random depth values", async () => {
    const randomDepths = [14.2, -5.3, 0.0, 102.5, -99.1, 3.14, 0.42];
    const res = await sorter.sort(randomDepths);
    for (let i = 1; i < res.depths.length; i++) {
      expect(res.depths[i]).toBeGreaterThanOrEqual(res.depths[i - 1]);
    }
  });

  it("6. preserves stable index ordering for duplicate depth values", async () => {
    // 3 identical depths with distinct original indices
    const depths = [5.0, 2.0, 5.0, 1.0, 5.0];
    const indices = [101, 102, 103, 104, 105];
    const res = await sorter.sort(depths, indices);

    expect(Array.from(res.depths)).toEqual([1.0, 2.0, 5.0, 5.0, 5.0]);
    // The three 5.0 elements must retain relative order 101, 103, 105
    expect(res.indices[2]).toBe(101);
    expect(res.indices[3]).toBe(103);
    expect(res.indices[4]).toBe(105);
  });

  it("7. handles negative depth values correctly", async () => {
    const depths = [-10.5, -2.1, -100.0, -0.5];
    const res = await sorter.sort(depths);
    expect(res.depths[0]).toBeCloseTo(-100.0, 4);
    expect(res.depths[1]).toBeCloseTo(-10.5, 4);
    expect(res.depths[2]).toBeCloseTo(-2.1, 4);
    expect(res.depths[3]).toBeCloseTo(-0.5, 4);
  });

  it("8. handles positive and negative zero", async () => {
    const depths = [1.0, -0.0, -1.0, +0.0];
    const res = await sorter.sort(depths);
    expect(res.depths[0]).toBe(-1.0);
    expect(res.depths[1]).toBeCloseTo(0.0);
    expect(res.depths[2]).toBeCloseTo(0.0);
    expect(res.depths[3]).toBe(1.0);
  });

  it("9. handles NaN and infinities according to documented policy", async () => {
    const depths = [5.0, -Infinity, NaN, Infinity, -2.0];
    const res = await sorter.sort(depths);
    expect(res.depths[0]).toBe(-Infinity);
    expect(res.depths[1]).toBe(-2.0);
    expect(res.depths[2]).toBe(5.0);
    expect(res.depths[3]).toBe(Infinity);
    // NaN is ordered to the end (infinity-max policy)
    expect(Number.isNaN(res.depths[4]) || res.depths[4] === Infinity).toBe(true);
  });

  it("10. handles non-power-of-two input lengths", async () => {
    const lengths = [3, 7, 13, 27, 99, 317];
    for (const len of lengths) {
      const arr = Array.from({ length: len }, (_, i) => len - i);
      const res = await sorter.sort(arr);
      expect(res.count).toBe(len);
      expect(res.depths[0]).toBe(1);
      expect(res.depths[len - 1]).toBe(len);
    }
  });

  it("11. sorts large input point clouds (>10,000 points)", async () => {
    const count = 15000;
    const depths = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      depths[i] = (count - i) * 0.1;
    }
    const res = await sorter.sort(depths);
    expect(res.count).toBe(count);
    expect(res.depths[0]).toBeCloseTo(0.1);
    expect(res.depths[count - 1]).toBeCloseTo(count * 0.1);
  });

  it("12. maintains correct association between sorted keys and point indices", async () => {
    const depths = [30.0, 10.0, 20.0];
    const indices = [999, 777, 888];
    const res = await sorter.sort(depths, indices);
    expect(Array.from(res.depths)).toEqual([10.0, 20.0, 30.0]);
    expect(Array.from(res.indices)).toEqual([777, 888, 999]);
  });

  it("13. supports explicit CPU fallback when WebGPU is unavailable", async () => {
    let fallbackMsg = "";
    const cpuSorter = await RadixSortCompute.create({
      forceCpu: true,
      onFallback: (r) => {
        fallbackMsg = r;
      },
    });
    expect(cpuSorter.currentBackend).toBe("cpu");
    expect(fallbackMsg).toContain("Force CPU");

    const res = await cpuSorter.sort([3.0, 1.0, 2.0]);
    expect(res.backend).toBe("cpu");
    expect(Array.from(res.depths)).toEqual([1.0, 2.0, 3.0]);
  });

  it("14. throws on invalid input lengths and respects error policies", async () => {
    // Mismatched lengths
    await expect(sorter.sort([1.0, 2.0], [0])).rejects.toThrow(/Mismatched input lengths/);

    // nanPolicy='error'
    await expect(
      sorter.sort([1.0, NaN, 3.0], undefined, { nanPolicy: "error" }),
    ).rejects.toThrow(/NaN depth encountered/);
  });

  it("15. executes exactly 8 radix passes for 4-bit radix sorting", async () => {
    const res = await sorter.sort([4.0, 2.0, 1.0]);
    expect(res.passes).toBe(RADIX_PASSES);
    expect(res.passes).toBe(8);
  });

  it("16. generates valid WGSL shader code with all 3 dispatch stages", () => {
    const wgsl = getRadixSortWGSL();
    expect(wgsl).toContain("computeHistogram");
    expect(wgsl).toContain("scanHistograms");
    expect(wgsl).toContain("scatterElements");
    expect(wgsl).toContain("localHistogram");
    expect(wgsl).toContain("localScan");
  });
});

describe("RadixSortCompute - WebGPU Dispatch Simulation & Mocks", () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete (globalThis as unknown as { navigator?: unknown }).navigator;
    }
  });

  it("initializes WebGPU pipeline and executes simulated dispatch", async () => {
    const capturedDispatches: number[] = [];
    const bufferDestroys: any[] = [];

    const mockDevice: any = {
      createShaderModule: () => ({}),
      createComputePipelineAsync: async () => ({
        getBindGroupLayout: () => ({}),
      }),
      createBuffer: ({ size }: { size: number }) => {
        const buf = {
          size,
          destroy: jest.fn(() => bufferDestroys.push(buf)),
        };
        return buf;
      },
      createBindGroup: () => ({}),
      createCommandEncoder: () => ({
        beginComputePass: () => ({
          setPipeline: () => {},
          setBindGroup: () => {},
          dispatchWorkgroups: (n: number) => capturedDispatches.push(n),
          end: () => {},
        }),
        finish: () => ({}),
      }),
      queue: {
        writeBuffer: () => {},
        submit: () => {},
        onSubmittedWorkDone: async () => {},
      },
      destroy: jest.fn(),
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        gpu: {
          requestAdapter: async () => ({
            requestDevice: async () => mockDevice,
          }),
        },
      },
      configurable: true,
    });

    expect(isWebGPUSupported()).toBe(true);

    const gpuSorter = await RadixSortCompute.create();
    expect(gpuSorter.currentBackend).toBe("webgpu");

    const res = await gpuSorter.sort([10.0, 2.0, 5.0]);
    expect(res.backend).toBe("webgpu");
    expect(Array.from(res.depths)).toEqual([2.0, 5.0, 10.0]);
    expect(capturedDispatches.length).toBeGreaterThan(0);
    // Buffers destroyed on completion
    expect(bufferDestroys.length).toBeGreaterThan(0);

    gpuSorter.destroy();
    expect(mockDevice.destroy).toHaveBeenCalled();
  });

  it("gracefully falls back to CPU if WebGPU dispatch throws", async () => {
    let fallbackNotice = "";
    const mockDevice: any = {
      createShaderModule: () => ({}),
      createComputePipelineAsync: async () => ({
        getBindGroupLayout: () => ({}),
      }),
      createBuffer: () => {
        throw new Error("Out of VRAM memory allocation failure");
      },
      queue: {
        writeBuffer: () => {},
        submit: () => {},
      },
      destroy: jest.fn(),
    };

    const gpuSorter = new RadixSortCompute(mockDevice);
    // Force pipeline availability
    (gpuSorter as any).histogramPipeline = {};
    (gpuSorter as any).scanPipeline = {};
    (gpuSorter as any).scatterPipeline = {};

    const res = await gpuSorter.sort([5.0, 1.0, 3.0], undefined, {
      onFallback: (reason) => {
        fallbackNotice = reason;
      },
    });

    expect(res.backend).toBe("cpu");
    expect(fallbackNotice).toContain("Out of VRAM memory allocation failure");
    expect(Array.from(res.depths)).toEqual([1.0, 3.0, 5.0]);
  });
});
