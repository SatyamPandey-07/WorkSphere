import {
  WebGPUFloorPlanRenderer,
  type FloorPlanData,
} from "@/lib/webgpu/floorPlanRenderer";

describe("WebGPUFloorPlanRenderer Context Loss & Recovery", () => {
  let canvas: HTMLCanvasElement;
  let sampleData: FloorPlanData;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 450;

    sampleData = {
      width: 10,
      depth: 10,
      height: 3,
      seats: [
        {
          x: 0,
          z: 0,
          type: "hot_desk",
          hasPower: true,
          isQuiet: false,
        },
      ],
      walls: [],
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("handles fallback gracefully when WebGPU is unavailable", async () => {
    const originalGpu = navigator.gpu;
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    });

    const renderer = new WebGPUFloorPlanRenderer(canvas);
    const success = await renderer.initialize();

    expect(success).toBe(false);
    expect(renderer.getIsDeviceLost()).toBe(false);

    // Restore navigator.gpu
    if (originalGpu) {
      Object.defineProperty(navigator, "gpu", {
        value: originalGpu,
        configurable: true,
      });
    }
  });

  it("registers device.lost listener and recovers on visibilitychange", async () => {
    let resolveDeviceLost: (info: { reason: string; message: string }) => void;
    const lostPromise = new Promise<{ reason: string; message: string }>(
      (resolve) => {
        resolveDeviceLost = resolve;
      },
    );

    const mockDevice = {
      lost: lostPromise,
      createShaderModule: jest.fn().mockReturnValue({}),
      createRenderPipeline: jest.fn().mockReturnValue({
        getBindGroupLayout: jest.fn().mockReturnValue({}),
      }),
      createBuffer: jest.fn().mockReturnValue({
        destroy: jest.fn(),
      }),
      createBindGroup: jest.fn().mockReturnValue({}),
      createTexture: jest.fn().mockReturnValue({
        createView: jest.fn().mockReturnValue({}),
        destroy: jest.fn(),
      }),
      createCommandEncoder: jest.fn().mockReturnValue({
        beginRenderPass: jest.fn().mockReturnValue({
          setPipeline: jest.fn(),
          setBindGroup: jest.fn(),
          setVertexBuffer: jest.fn(),
          setIndexBuffer: jest.fn(),
          drawIndexed: jest.fn(),
          end: jest.fn(),
        }),
        finish: jest.fn(),
      }),
      queue: {
        writeBuffer: jest.fn(),
        submit: jest.fn(),
      },
      destroy: jest.fn(),
    };

    const mockContext = {
      configure: jest.fn(),
      getCurrentTexture: jest.fn().mockReturnValue({
        createView: jest.fn(),
      }),
    };

    const mockGpu = {
      requestAdapter: jest.fn().mockResolvedValue({
        requestDevice: jest.fn().mockResolvedValue(mockDevice),
      }),
      getPreferredCanvasFormat: jest.fn().mockReturnValue("rgba8unorm"),
    };

    Object.defineProperty(navigator, "gpu", {
      value: mockGpu,
      configurable: true,
      writable: true,
    });

    jest.spyOn(canvas, "getContext").mockReturnValue(mockContext as any);

    const renderer = new WebGPUFloorPlanRenderer(canvas);
    const success = await renderer.initialize();

    expect(success).toBe(true);
    expect(renderer.getIsDeviceLost()).toBe(false);

    renderer.loadFloorPlan(sampleData);

    // Simulate device loss (e.g. system sleep)
    resolveDeviceLost!({
      reason: "destroyed",
      message: "Device was lost during sleep",
    });

    await lostPromise;
    // Allow microtasks to execute
    await new Promise((r) => setTimeout(r, 0));

    expect(renderer.getIsDeviceLost()).toBe(true);
    expect(renderer.getDevice()).toBeNull();

    // Render should safely return without throwing errors when device is lost
    expect(() => renderer.render()).not.toThrow();

    // Simulate visibility change to "visible" (e.g. system wake)
    const reinitSpy = jest.spyOn(renderer, "reinitialize");

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
      writable: true,
    });

    document.dispatchEvent(new Event("visibilitychange"));

    expect(reinitSpy).toHaveBeenCalled();

    renderer.destroy();
  });

  it("removes event listeners on destroy", () => {
    const removeListenerSpy = jest.spyOn(document, "removeEventListener");
    const renderer = new WebGPUFloorPlanRenderer(canvas);

    renderer.destroy();

    expect(removeListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});
