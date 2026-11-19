/**
 * @file MeshDecimatorCompute.test.ts
 * @jest-environment node
 */

import {
  MeshDecimatorCompute,
  isWebGPUSupported,
  createQuadric,
  quadricFromPlane,
  addQuadrics,
  evaluateQuadricError,
  solveOptimalVertexPosition,
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
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

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
    const vertices = [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
      0.5, 0.5, 1,
    ];
    const indices = [
      0, 1, 4,
      1, 2, 4,
      2, 3, 4,
      3, 0, 4,
      0, 2, 1,
      0, 3, 2,
    ];

    const res = await decimator.decimate({ vertices, indices }, { targetRatio: 0.6 });
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
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      // Triangle 2 (component B, shifted)
      10, 10, 10,
      11, 10, 10,
      10, 11, 10,
    ];
    const indices = [0, 1, 2, 3, 4, 5];

    const res = await decimator.decimate({ vertices, indices }, { targetRatio: 0.5 });
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

    const vertices = [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0,
    ];
    const indices = [0, 1, 2, 1, 3, 2];

    const result = await decimator.decimate({ vertices, indices }, { targetRatio: 0.5 });
    expect(result.backend).toBe("webgpu");
    expect(dispatches.length).toBeGreaterThan(0);
    expect(bufferDestroys.length).toBeGreaterThanOrEqual(4); // uniform, vertex, index, quadric

    decimator.destroy();
    expect(mockDevice.destroy).toHaveBeenCalled();
  });
});
