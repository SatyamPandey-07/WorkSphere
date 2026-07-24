import {
  CrowdSimulationEngine,
  type SimulationConfig,
} from "../../../lib/webgpu/crowdSimulation";
import { computeShader } from "../../../lib/webgpu/crowdShaders.wgsl";

describe("WebGPU Crowd Simulation Buffer Overflow & Fallback Suite (#1282)", () => {
  let mockCanvas: HTMLCanvasElement;
  let baseConfig: SimulationConfig;

  beforeEach(() => {
    mockCanvas = {
      width: 800,
      height: 600,
      getContext: jest.fn(),
    } as unknown as HTMLCanvasElement;

    baseConfig = {
      agentCount: 25000,
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
});
