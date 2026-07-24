import {
  CrowdSimulationEngine,
  type SimulationConfig,
} from "../../../lib/webgpu/crowdSimulation";
import {
  CrowdFallbackRenderer,
  createCrowdSimulatorWithFallback,
} from "../../../lib/webgpu/crowdFallback";
import { computeShader } from "../../../lib/webgpu/crowdShaders.wgsl";

describe("WebGPU Crowd Simulation Buffer Overflow & Fallback Suite", () => {
  let mockCanvas: HTMLCanvasElement;
  let baseConfig: SimulationConfig;

  beforeEach(() => {
    mockCanvas = {
      width: 800,
      height: 600,
      getContext: jest.fn(),
    } as unknown as HTMLCanvasElement;

    baseConfig = {
      agentCount: 5000,
      worldWidth: 100,
      worldHeight: 100,
      exitPositions: [[10, 10]],
      wallSegments: [],
    };
  });

  it("includes arrayLength bounds checking in WGSL compute shader", () => {
    expect(computeShader).toContain("arrayLength(&agentsIn)");
    expect(computeShader).toContain("arrayLength(&exits)");
    expect(computeShader).toContain("arrayLength(&walls)");
  });

  it("calculates 80% capacity threshold and triggers buffer reallocation when agent count exceeds 80%", async () => {
    const engine = new CrowdSimulationEngine(mockCanvas, baseConfig);

    expect(engine.getAllocatedCapacity()).toBe(10000);
    expect(engine.getCapacityThreshold()).toBe(8000);

    // Below 80% threshold (e.g. 7000 agents)
    expect(engine.isReallocationNeeded(7000)).toBe(false);

    // Exceeding 80% threshold (e.g. 8500 agents)
    expect(engine.isReallocationNeeded(8500)).toBe(true);

    const isReallocated = await engine.reallocateBuffers(20000);
    expect(isReallocated).toBe(true);
    expect(engine.getAllocatedCapacity()).toBe(20000);
    expect(engine.getCapacityThreshold()).toBe(16000);
  });

  it("rejects initialization and falls back gracefully when agent payload exceeds GPU buffer limits", async () => {
    const hugeConfig: SimulationConfig = {
      ...baseConfig,
      agentCount: 10000000, // 10 Million agents = ~320MB > default 128MB limit
    };

    const mockDevice = {
      limits: {
        maxStorageBufferBindingSize: 134217728, // 128MB
        maxBufferSize: 268435456, // 256MB
      },
      createBuffer: jest.fn(),
      lost: new Promise(() => {}),
    };

    const mockAdapter = {
      requestDevice: jest.fn().mockResolvedValue(mockDevice),
    };

    Object.defineProperty(navigator, "gpu", {
      value: {
        requestAdapter: jest.fn().mockResolvedValue(mockAdapter),
        getPreferredCanvasFormat: jest.fn().mockReturnValue("rgba8unorm"),
      },
      configurable: true,
      writable: true,
    });

    (mockCanvas.getContext as jest.Mock).mockReturnValue({
      configure: jest.fn(),
    });

    const engine = new CrowdSimulationEngine(mockCanvas, hugeConfig);
    const success = await engine.initialize();

    expect(success).toBe(false);
  });

  it("falls back automatically to CPU renderer when WebGPU device creation fails", async () => {
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const result = await createCrowdSimulatorWithFallback(
      mockCanvas,
      baseConfig,
    );

    expect(result.isWebGPU).toBe(false);
    expect(result.engine).toBeInstanceOf(CrowdFallbackRenderer);
  });
});
