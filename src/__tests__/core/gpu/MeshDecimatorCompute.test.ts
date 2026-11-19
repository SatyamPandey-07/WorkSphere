/**
 * @file MeshDecimatorCompute.test.ts
 * @jest-environment node
 */

import {
  MeshDecimatorCompute,
  isWebGPUSupported,
  quadricFromPlane,
  addQuadrics,
  evaluateQuadricError,
  solveOptimalVertexPosition,
  selectAdaptiveWorkgroupSize,
  calculateDispatchWorkgroups,
  getQEMComputeWgsl,
  SMALL_WORKLOAD_TRIANGLE_THRESHOLD,
  MEDIUM_WORKLOAD_TRIANGLE_THRESHOLD,
  type DecimationMesh,
} from "../../../core/gpu/MeshDecimatorCompute";

describe("MeshDecimatorCompute - Mathematical Foundations", () => {
  it("constructs plane quadric correctly", () => {
    // Plane: z = 0 (0*x + 0*y + 1*z + 0 = 0)
    const q = quadricFromPlane(0, 0, 1, 0);
    expect(q[7]).toBeCloseTo(1.0); // c * c = 1
    expect(q[0]).toBeCloseTo(0.0); // a * a = 0

    // Distance of point (0, 0, 5) to z=0 plane should have error = 5^2 = 25
    const err = evaluateQuadricError(q, 0, 0, 5);
    expect(err).toBeCloseTo(25.0);

    // Distance of point on plane (2, 3, 0) should have error = 0
    const errOnPlane = evaluateQuadricError(q, 2, 3, 0);
    expect(errOnPlane).toBeCloseTo(0.0);
  });

  it("accumulates quadrics additively", () => {
    // Plane 1: x = 0 (error = x^2)
    const q1 = quadricFromPlane(1, 0, 0, 0);
    // Plane 2: y = 0 (error = y^2)
    const q2 = quadricFromPlane(0, 1, 0, 0);

    const qSum = addQuadrics(q1, q2);
    // Point (3, 4, 0): error = 3^2 + 4^2 = 25
    const err = evaluateQuadricError(qSum, 3, 4, 0);
    expect(err).toBeCloseTo(25.0);
  });

  it("solves optimal vertex position minimizing error", () => {
    // Three orthogonal planes: x=0, y=0, z=0
    const qx = quadricFromPlane(1, 0, 0, 0);
    const qy = quadricFromPlane(0, 1, 0, 0);
    const qz = quadricFromPlane(0, 0, 1, 0);
    const q = addQuadrics(addQuadrics(qx, qy), qz);

    const sol = solveOptimalVertexPosition(q, [1, 2, 3], [-1, -2, -3]);
    expect(sol.position[0]).toBeCloseTo(0, 4);
    expect(sol.position[1]).toBeCloseTo(0, 4);
    expect(sol.position[2]).toBeCloseTo(0, 4);
    expect(sol.error).toBeCloseTo(0, 4);
  });
});

describe("MeshDecimatorCompute - Decimation Pipeline & Fallback", () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete (globalThis as any).navigator;
    }
  });

  it("falls back to CPU when navigator.gpu is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    expect(isWebGPUSupported()).toBe(false);

    let fallbackReason = "";
    const decimator = await MeshDecimatorCompute.create({
      onFallback: (reason) => {
        fallbackReason = reason;
      },
    });

    expect(decimator.backend).toBe("cpu");
    expect(fallbackReason).toContain("WebGPU");
  });

  it("simplifies a grid plane mesh and reduces vertex count towards target", async () => {
    const decimator = await MeshDecimatorCompute.create({ forceCpu: true });

    // Generate a 10x10 planar grid (100 vertices, 162 triangles)
    const gridSize = 10;
    const vertices: number[] = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        vertices.push(x * 0.1, y * 0.1, 0.0);
      }
    }

    const indices: number[] = [];
    for (let y = 0; y < gridSize - 1; y++) {
      for (let x = 0; x < gridSize - 1; x++) {
        const i0 = y * gridSize + x;
        const i1 = y * gridSize + (x + 1);
        const i2 = (y + 1) * gridSize + x;
        const i3 = (y + 1) * gridSize + (x + 1);

        indices.push(i0, i1, i2);
        indices.push(i1, i3, i2);
      }
    }

    const inputMesh: DecimationMesh = { vertices, indices };
    const res = await decimator.decimate(inputMesh, { targetRatio: 0.25 });

    expect(res.backend).toBe("cpu");
    expect(res.initialVertexCount).toBe(100);
    expect(res.finalVertexCount).toBeLessThan(100);
    expect(res.finalVertexCount).toBeGreaterThanOrEqual(3);
    expect(res.reductionRatio).toBeGreaterThan(0.5);
    expect(res.isManifold).toBe(true);
    expect(res.mesh.normals).toBeDefined();
    expect(res.mesh.normals!.length).toBe(res.mesh.vertices.length);
  });

  it("preserves manifold topology and removes degenerate triangles", async () => {
    const decimator = await MeshDecimatorCompute.create({ forceCpu: true });

    // A pyramid mesh
    const vertices = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 0.5, 1];
    const indices = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 2, 1, 0, 3, 2];

    const res = await decimator.decimate(
      { vertices, indices },
      { targetRatio: 0.6 },
    );
    expect(res.isManifold).toBe(true);
    expect(res.finalTriangleCount).toBeGreaterThan(0);
    expect(res.finalVertexCount).toBeLessThanOrEqual(5);
  });

  it("handles empty or degenerate input safely without throwing", async () => {
    const decimator = await MeshDecimatorCompute.create({ forceCpu: true });
    const res = await decimator.decimate({ vertices: [], indices: [] });
    expect(res.initialVertexCount).toBe(0);
    expect(res.finalVertexCount).toBe(0);
  });

  it("handles disconnected mesh components and non-finite / NaN values safely", async () => {
    const decimator = await MeshDecimatorCompute.create({ forceCpu: true });

    // Two separate disconnected triangles with valid and non-finite data
    const vertices = [
      // Triangle 1 (component A)
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      // Triangle 2 (component B, shifted)
      10, 10, 10, 11, 10, 10, 10, 11, 10,
    ];
    const indices = [0, 1, 2, 3, 4, 5];

    const res = await decimator.decimate(
      { vertices, indices },
      { targetRatio: 0.5 },
    );
    expect(res.initialVertexCount).toBe(6);
    expect(res.finalVertexCount).toBeGreaterThanOrEqual(3);
    expect(res.mesh.vertices.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("MeshDecimatorCompute - WebGPU Pipeline Simulation", () => {
  it("executes WebGPU dispatch when GPU device is available and cleans up buffers", async () => {
    const dispatches: number[] = [];
    const bufferDestroys: any[] = [];

    const mockDevice: any = {
      createShaderModule: () => ({
        getCompilationInfo: async () => ({ messages: [] }),
      }),
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
          dispatchWorkgroups: (n: number) => dispatches.push(n),
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

    const decimator = await MeshDecimatorCompute.create();
    expect(decimator.backend).toBe("webgpu");

    const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];
    const indices = [0, 1, 2, 1, 3, 2];

    const result = await decimator.decimate(
      { vertices, indices },
      { targetRatio: 0.5 },
    );
    expect(result.backend).toBe("webgpu");
    expect(dispatches.length).toBeGreaterThan(0);
    expect(bufferDestroys.length).toBeGreaterThanOrEqual(4); // uniform, vertex, index, quadric

    decimator.destroy();
    expect(mockDevice.destroy).toHaveBeenCalled();
  });
});

describe("MeshDecimatorCompute - Adaptive Workgroup Sizing & Limits", () => {
  it("small point-cloud workload selects the intended smaller configuration (64)", () => {
    const limits = {
      maxComputeWorkgroupSizeX: 256,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupsPerDimension: 65535,
    };
    const size = selectAdaptiveWorkgroupSize(
      SMALL_WORKLOAD_TRIANGLE_THRESHOLD - 1,
      limits,
    );
    expect(size).toBe(64);
  });

  it("medium workload selects the intended intermediate configuration (128)", () => {
    const limits = {
      maxComputeWorkgroupSizeX: 256,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupsPerDimension: 65535,
    };
    const size = selectAdaptiveWorkgroupSize(
      MEDIUM_WORKLOAD_TRIANGLE_THRESHOLD - 1,
      limits,
    );
    expect(size).toBe(128);
  });

  it("large workload selects 256 when device limits permit", () => {
    const limits = {
      maxComputeWorkgroupSizeX: 256,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupsPerDimension: 65535,
    };
    const size = selectAdaptiveWorkgroupSize(100_000, limits);
    expect(size).toBe(256);
  });

  it("device supporting only 64 never selects 128 or 256", () => {
    const limits = {
      maxComputeWorkgroupSizeX: 64,
      maxComputeInvocationsPerWorkgroup: 64,
      maxComputeWorkgroupsPerDimension: 65535,
    };
    expect(selectAdaptiveWorkgroupSize(500, limits)).toBe(64);
    expect(selectAdaptiveWorkgroupSize(10_000, limits)).toBe(64);
    expect(selectAdaptiveWorkgroupSize(500_000, limits)).toBe(64);
  });

  it("device supporting 128 but not 256 selects a valid supported size", () => {
    const limits = {
      maxComputeWorkgroupSizeX: 128,
      maxComputeInvocationsPerWorkgroup: 128,
      maxComputeWorkgroupsPerDimension: 65535,
    };
    expect(selectAdaptiveWorkgroupSize(500, limits)).toBe(64);
    expect(selectAdaptiveWorkgroupSize(10_000, limits)).toBe(128);
    expect(selectAdaptiveWorkgroupSize(200_000, limits)).toBe(128); // Capped at 128
  });

  it("device limits below the preferred sizes (e.g. max 32) are handled safely", () => {
    const limits = {
      maxComputeWorkgroupSizeX: 32,
      maxComputeInvocationsPerWorkgroup: 32,
      maxComputeWorkgroupsPerDimension: 65535,
    };
    expect(selectAdaptiveWorkgroupSize(1000, limits)).toBeNull();
  });

  it("handles zero-length or negative input safely without invalid dispatch", () => {
    expect(calculateDispatchWorkgroups(0, 64)).toBe(0);
    expect(calculateDispatchWorkgroups(-10, 64)).toBe(0);
    expect(calculateDispatchWorkgroups(100, 0)).toBe(0);
    expect(calculateDispatchWorkgroups(NaN, 64)).toBe(0);
  });

  it("calculates workgroup dispatch counts correctly using ceiling division", () => {
    expect(calculateDispatchWorkgroups(64, 64)).toBe(1);
    expect(calculateDispatchWorkgroups(65, 64)).toBe(2);
    expect(calculateDispatchWorkgroups(128, 64)).toBe(2);
    expect(calculateDispatchWorkgroups(129, 64)).toBe(3);
    expect(calculateDispatchWorkgroups(128, 128)).toBe(1);
    expect(calculateDispatchWorkgroups(129, 128)).toBe(2);
    expect(calculateDispatchWorkgroups(256, 256)).toBe(1);
    expect(calculateDispatchWorkgroups(257, 256)).toBe(2);
  });

  it("large inputs respect maximum dispatch dimensions", () => {
    const maxWorkgroups = 1000;
    const workgroups = calculateDispatchWorkgroups(
      10_000_000,
      64,
      maxWorkgroups,
    );
    expect(workgroups).toBe(maxWorkgroups);
  });

  it("shader workgroup size matches the selected pipeline configuration", () => {
    expect(getQEMComputeWgsl(64)).toContain("@workgroup_size(64)");
    expect(getQEMComputeWgsl(128)).toContain("@workgroup_size(128)");
    expect(getQEMComputeWgsl(256)).toContain("@workgroup_size(256)");
  });

  it("reuses pipeline variants instead of recreating them unnecessarily", async () => {
    const compiledWgsl: string[] = [];

    const mockDevice: any = {
      limits: {
        maxComputeWorkgroupSizeX: 256,
        maxComputeInvocationsPerWorkgroup: 256,
        maxComputeWorkgroupsPerDimension: 65535,
      },
      createShaderModule: ({ code }: { code: string }) => {
        compiledWgsl.push(code);
        return {
          getCompilationInfo: async () => ({ messages: [] }),
        };
      },
      createComputePipelineAsync: async () => ({
        getBindGroupLayout: () => ({}),
      }),
      createBuffer: ({ size }: { size: number }) => ({
        size,
        destroy: jest.fn(),
      }),
      createBindGroup: () => ({}),
      createCommandEncoder: () => ({
        beginComputePass: () => ({
          setPipeline: () => {},
          setBindGroup: () => {},
          dispatchWorkgroups: () => {},
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

    const decimator = await MeshDecimatorCompute.create();
    expect(decimator.backend).toBe("webgpu");

    // Default pipeline at 64 was created during initialization
    expect(compiledWgsl.length).toBe(1);

    // Requesting pipeline for 64 should reuse cache without compiling new shader
    const p64_1 = await decimator.getPipelineForWorkgroupSize(64);
    const p64_2 = await decimator.getPipelineForWorkgroupSize(64);
    expect(p64_1).toBe(p64_2);
    expect(compiledWgsl.length).toBe(1);

    // Requesting pipeline for 128 compiles it once
    const p128_1 = await decimator.getPipelineForWorkgroupSize(128);
    const p128_2 = await decimator.getPipelineForWorkgroupSize(128);
    expect(p128_1).toBe(p128_2);
    expect(compiledWgsl.length).toBe(2);

    // Requesting pipeline for 256 compiles it once
    const p256_1 = await decimator.getPipelineForWorkgroupSize(256);
    const p256_2 = await decimator.getPipelineForWorkgroupSize(256);
    expect(p256_1).toBe(p256_2);
    expect(compiledWgsl.length).toBe(3);

    decimator.destroy();
  });

  it("falls back to CPU when device limits are too low (< 64)", async () => {
    let fallbackMsg = "";
    const mockDevice: any = {
      limits: {
        maxComputeWorkgroupSizeX: 32,
        maxComputeInvocationsPerWorkgroup: 32,
        maxComputeWorkgroupsPerDimension: 65535,
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

    const decimator = await MeshDecimatorCompute.create({
      onFallback: (reason) => {
        fallbackMsg = reason;
      },
    });

    expect(decimator.backend).toBe("cpu");
    expect(fallbackMsg).toContain(
      "GPU device compute limits below minimum workgroup size 64",
    );
    expect(mockDevice.destroy).toHaveBeenCalled();
  });

  it("handles WebGPU execution failure gracefully by falling back to CPU", async () => {
    let fallbackMsg = "";
    const mockDevice: any = {
      limits: {
        maxComputeWorkgroupSizeX: 256,
        maxComputeInvocationsPerWorkgroup: 256,
        maxComputeWorkgroupsPerDimension: 65535,
      },
      createShaderModule: () => ({
        getCompilationInfo: async () => ({ messages: [] }),
      }),
      createComputePipelineAsync: async () => ({
        getBindGroupLayout: () => ({}),
      }),
      createBuffer: () => {
        throw new Error("Out of VRAM memory allocation failure");
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

    const decimator = await MeshDecimatorCompute.create();
    expect(decimator.backend).toBe("webgpu");

    const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];
    const indices = [0, 1, 2, 1, 3, 2];

    const result = await decimator.decimate(
      { vertices, indices },
      {
        targetRatio: 0.5,
        onFallback: (reason) => {
          fallbackMsg = reason;
        },
      },
    );

    expect(result.backend).toBe("cpu");
    expect(fallbackMsg).toContain("Out of VRAM memory allocation failure");
    expect(result.finalVertexCount).toBeGreaterThanOrEqual(3);
    decimator.destroy();
  });

  it("adapts workgroup size dynamically based on input workload and reports workgroupSize and dispatchCount", async () => {
    const capturedDispatches: { workgroupSize?: number; count: number }[] = [];

    const mockDevice: any = {
      limits: {
        maxComputeWorkgroupSizeX: 256,
        maxComputeInvocationsPerWorkgroup: 256,
        maxComputeWorkgroupsPerDimension: 65535,
      },
      createShaderModule: () => ({
        getCompilationInfo: async () => ({ messages: [] }),
      }),
      createComputePipelineAsync: async () => ({
        getBindGroupLayout: () => ({}),
      }),
      createBuffer: ({ size }: { size: number }) => ({
        size,
        destroy: jest.fn(),
      }),
      createBindGroup: () => ({}),
      createCommandEncoder: () => ({
        beginComputePass: () => ({
          setPipeline: () => {},
          setBindGroup: () => {},
          dispatchWorkgroups: (count: number) => {
            capturedDispatches.push({ count });
          },
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

    const decimator = await MeshDecimatorCompute.create();

    // 1. Small mesh (2 triangles) -> should select workgroup size 64
    const smallMesh: DecimationMesh = {
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
      indices: [0, 1, 2, 1, 3, 2],
    };
    const resSmall = await decimator.decimate(smallMesh);
    expect(resSmall.backend).toBe("webgpu");
    expect(resSmall.workgroupSize).toBe(64);
    expect(resSmall.dispatchCount).toBe(1);

    // 2. Medium mesh (3,000 triangles) -> should select workgroup size 128
    const medIndices = new Uint32Array(3000 * 3);
    const medVertices = new Float32Array((3000 + 2) * 3);
    const medMesh: DecimationMesh = {
      vertices: medVertices,
      indices: medIndices,
    };
    const resMed = await decimator.decimate(medMesh);
    expect(resMed.backend).toBe("webgpu");
    expect(resMed.workgroupSize).toBe(128);
    expect(resMed.dispatchCount).toBe(Math.ceil(3000 / 128)); // 24

    // 3. Large mesh (40,000 triangles) -> should select workgroup size 256
    const largeIndices = new Uint32Array(40000 * 3);
    const largeVertices = new Float32Array((40000 + 2) * 3);
    const largeMesh: DecimationMesh = {
      vertices: largeVertices,
      indices: largeIndices,
    };
    const resLarge = await decimator.decimate(largeMesh);
    expect(resLarge.backend).toBe("webgpu");
    expect(resLarge.workgroupSize).toBe(256);
    expect(resLarge.dispatchCount).toBe(Math.ceil(40000 / 256)); // 157

    decimator.destroy();
  });
});

describe("MeshDecimatorCompute - Workgroup Configuration Benchmark Simulation", () => {
  it("evaluates and compares workgroup configurations (64, 128, 256) across representative point-cloud sizes", async () => {
    // Representative workloads:
    // Small: 1,000 triangles (~600 points)
    // Medium: 10,000 triangles (~5,500 points)
    // Large: 50,000 triangles (~26,000 points)
    const testCases = [
      { name: "Small point cloud", triangleCount: 1_000, vertexCount: 600 },
      { name: "Medium point cloud", triangleCount: 10_000, vertexCount: 5_500 },
      {
        name: "Large point cloud (LiDAR scan)",
        triangleCount: 50_000,
        vertexCount: 26_000,
      },
    ];

    const standardLimits = {
      maxComputeWorkgroupSizeX: 256,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupsPerDimension: 65535,
    };

    const benchmarkReports: {
      workload: string;
      triangles: number;
      vertices: number;
      selectedWorkgroupSize: number | null;
      adaptiveDispatches: number;
      fixed64Dispatches: number;
      fixed128Dispatches: number;
      fixed256Dispatches: number;
      dispatchReductionPctVsFixed64: number;
      environment: string;
    }[] = [];

    for (const tc of testCases) {
      const selectedSize = selectAdaptiveWorkgroupSize(
        tc.triangleCount,
        standardLimits,
      );
      const adaptiveDispatches = calculateDispatchWorkgroups(
        tc.triangleCount,
        selectedSize!,
      );
      const fixed64Dispatches = calculateDispatchWorkgroups(
        tc.triangleCount,
        64,
      );
      const fixed128Dispatches = calculateDispatchWorkgroups(
        tc.triangleCount,
        128,
      );
      const fixed256Dispatches = calculateDispatchWorkgroups(
        tc.triangleCount,
        256,
      );

      const dispatchReductionPctVsFixed64 =
        ((fixed64Dispatches - adaptiveDispatches) / fixed64Dispatches) * 100;

      benchmarkReports.push({
        workload: tc.name,
        triangles: tc.triangleCount,
        vertices: tc.vertexCount,
        selectedWorkgroupSize: selectedSize,
        adaptiveDispatches,
        fixed64Dispatches,
        fixed128Dispatches,
        fixed256Dispatches,
        dispatchReductionPctVsFixed64: Number(
          dispatchReductionPctVsFixed64.toFixed(1),
        ),
        environment:
          "Node.js simulated WebGPU limits (deterministic dispatch benchmark)",
      });
    }

    // Verify benchmark expectations:
    // 1. Small workload: selects 64, matches fixed-64 dispatches
    expect(benchmarkReports[0].selectedWorkgroupSize).toBe(64);
    expect(benchmarkReports[0].adaptiveDispatches).toBe(Math.ceil(1000 / 64)); // 16

    // 2. Medium workload: selects 128, reduces dispatches by 50% vs fixed 64
    expect(benchmarkReports[1].selectedWorkgroupSize).toBe(128);
    expect(benchmarkReports[1].adaptiveDispatches).toBe(Math.ceil(10000 / 128)); // 79 vs 157
    expect(benchmarkReports[1].dispatchReductionPctVsFixed64).toBeCloseTo(
      49.7,
      1,
    );

    // 3. Large workload: selects 256, reduces dispatches by 75% vs fixed 64
    expect(benchmarkReports[2].selectedWorkgroupSize).toBe(256);
    expect(benchmarkReports[2].adaptiveDispatches).toBe(Math.ceil(50000 / 256)); // 196 vs 782
    expect(benchmarkReports[2].dispatchReductionPctVsFixed64).toBeCloseTo(
      74.9,
      1,
    );
  });
});
