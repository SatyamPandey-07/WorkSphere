import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  HeatDiffusionViewer,
  cleanupWebGLBuffers,
  allocateWebGLBuffers,
  type WebGLResourceHandles,
} from "@/components/HeatDiffusionViewer";

// Stub requestAnimationFrame so the RAF loop never actually fires in tests.
global.requestAnimationFrame = jest.fn((cb) => {
  const timer = setTimeout(cb, 16);
  (timer as any)?.unref?.();
  return timer as unknown as number;
});
global.cancelAnimationFrame = jest.fn((id) => {
  clearTimeout(id as any);
});

// Stub performance.now so FPS counters don't fail.
global.performance = { now: jest.fn(() => 0) } as unknown as Performance;

// WASM import will reject in jsdom — the component must fall back gracefully.
jest.mock(
  "../../wasm/heat-diffusion/pkg/heat_diffusion.js",
  () => {
    throw new Error("wasm not compiled");
  },
  { virtual: true },
);

// Minimal 2D canvas context so putImageData / createImageData don't crash.
HTMLCanvasElement.prototype.getContext = jest.fn((type: string) => {
  if (type === "2d") {
    return {
      createImageData: jest.fn(() => ({
        data: new Uint8ClampedArray(80 * 60 * 4),
        width: 80,
        height: 60,
      })),
      putImageData: jest.fn(),
    };
  }
  return null;
}) as typeof HTMLCanvasElement.prototype.getContext;

describe("HeatDiffusionViewer", () => {
  it("renders the component heading", () => {
    render(<HeatDiffusionViewer width={320} height={200} />);
    expect(screen.getByText(/Heat Diffusion Viewer/i)).toBeInTheDocument();
  });

  it("renders the interactive canvas with accessible label", () => {
    render(<HeatDiffusionViewer width={320} height={200} />);
    expect(
      screen.getByLabelText(/Venue heat diffusion canvas/i),
    ).toBeInTheDocument();
  });

  it("exposes pause and reset controls", () => {
    render(<HeatDiffusionViewer />);
    expect(screen.getByLabelText(/Pause simulation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reset simulation/i)).toBeInTheDocument();
  });

  it("shows all three node-kind buttons", () => {
    render(<HeatDiffusionViewer />);
    expect(screen.getByText(/Coffee Machine/i)).toBeInTheDocument();
    expect(screen.getByText(/Sunlit Window/i)).toBeInTheDocument();
    expect(screen.getByText(/AC Vent/i)).toBeInTheDocument();
  });

  it("pause button toggles label to Resume after click", () => {
    render(<HeatDiffusionViewer />);
    const btn = screen.getByLabelText(/Pause simulation/i);
    fireEvent.click(btn);
    expect(screen.getByLabelText(/Resume simulation/i)).toBeInTheDocument();
  });

  describe("WebGL Buffer Allocation and Deletion Lifecycle", () => {
    const createMockGl = () => {
      let textureId = 0;
      let fbId = 0;
      let rbId = 0;
      return {
        createTexture: jest.fn(() => ({ id: ++textureId })),
        deleteTexture: jest.fn(),
        bindTexture: jest.fn(),
        texImage2D: jest.fn(),
        texParameteri: jest.fn(),
        createFramebuffer: jest.fn(() => ({ id: ++fbId })),
        deleteFramebuffer: jest.fn(),
        bindFramebuffer: jest.fn(),
        framebufferTexture2D: jest.fn(),
        createRenderbuffer: jest.fn(() => ({ id: ++rbId })),
        deleteRenderbuffer: jest.fn(),
        viewport: jest.fn(),
        TEXTURE_2D: 0x0de1,
        FRAMEBUFFER: 0x8d40,
        COLOR_ATTACHMENT0: 0x8ce0,
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        NEAREST: 0x2600,
        CLAMP_TO_EDGE: 0x812f,
      } as unknown as WebGLRenderingContext;
    };

    it("properly deletes old WebGL textures and framebuffers via gl.deleteTexture() and gl.deleteFramebuffer()", () => {
      const mockGl = createMockGl();
      const handles: WebGLResourceHandles = {
        textureA: { id: "texA" } as unknown as WebGLTexture,
        textureB: { id: "texB" } as unknown as WebGLTexture,
        fbA: { id: "fbA" } as unknown as WebGLFramebuffer,
        fbB: { id: "fbB" } as unknown as WebGLFramebuffer,
        rbA: { id: "rbA" } as unknown as WebGLRenderbuffer,
        rbB: { id: "rbB" } as unknown as WebGLRenderbuffer,
      };

      cleanupWebGLBuffers(mockGl, handles);

      expect(mockGl.deleteTexture).toHaveBeenCalledTimes(2);
      expect(mockGl.deleteTexture).toHaveBeenCalledWith({ id: "texA" });
      expect(mockGl.deleteTexture).toHaveBeenCalledWith({ id: "texB" });

      expect(mockGl.deleteFramebuffer).toHaveBeenCalledTimes(2);
      expect(mockGl.deleteFramebuffer).toHaveBeenCalledWith({ id: "fbA" });
      expect(mockGl.deleteFramebuffer).toHaveBeenCalledWith({ id: "fbB" });

      expect(mockGl.deleteRenderbuffer).toHaveBeenCalledTimes(2);
      expect(handles.textureA).toBeNull();
      expect(handles.textureB).toBeNull();
      expect(handles.fbA).toBeNull();
      expect(handles.fbB).toBeNull();
    });

    it("allocates new WebGL textures and framebuffers, disposing existing resources first", () => {
      const mockGl = createMockGl();
      const initialHandles = allocateWebGLBuffers(mockGl, 80, 60);

      expect(mockGl.createTexture).toHaveBeenCalledTimes(2);
      expect(mockGl.createFramebuffer).toHaveBeenCalledTimes(2);
      expect(initialHandles.textureA).toBeTruthy();
      expect(initialHandles.textureB).toBeTruthy();
      expect(initialHandles.fbA).toBeTruthy();
      expect(initialHandles.fbB).toBeTruthy();

      // Allocating new dimensions must delete previous textures and framebuffers first
      const resizedHandles = allocateWebGLBuffers(
        mockGl,
        160,
        120,
        initialHandles,
      );

      expect(mockGl.deleteTexture).toHaveBeenCalledTimes(2);
      expect(mockGl.deleteFramebuffer).toHaveBeenCalledTimes(2);
      expect(resizedHandles.textureA).toBeTruthy();
      expect(resizedHandles.textureB).toBeTruthy();
    });
  });

  describe("WebGL Context Lost & Restored Events and Resize Debouncing", () => {
    let mockGl: ReturnType<typeof createMockWebGLContext>;
    const createMockWebGLContext = () => ({
      createTexture: jest.fn(() => ({})),
      deleteTexture: jest.fn(),
      bindTexture: jest.fn(),
      texImage2D: jest.fn(),
      texParameteri: jest.fn(),
      createFramebuffer: jest.fn(() => ({})),
      deleteFramebuffer: jest.fn(),
      bindFramebuffer: jest.fn(),
      framebufferTexture2D: jest.fn(),
      createRenderbuffer: jest.fn(() => ({})),
      deleteRenderbuffer: jest.fn(),
      viewport: jest.fn(),
      TEXTURE_2D: 0x0de1,
      FRAMEBUFFER: 0x8d40,
      COLOR_ATTACHMENT0: 0x8ce0,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      NEAREST: 0x2600,
      CLAMP_TO_EDGE: 0x812f,
    });

    beforeEach(() => {
      mockGl = createMockWebGLContext();
      (HTMLCanvasElement.prototype.getContext as jest.Mock).mockImplementation(
        (type: string) => {
          if (type === "webgl" || type === "webgl2") {
            return mockGl;
          }
          if (type === "2d") {
            return {
              createImageData: jest.fn(() => ({
                data: new Uint8ClampedArray(80 * 60 * 4),
                width: 80,
                height: 60,
              })),
              putImageData: jest.fn(),
            };
          }
          return null;
        },
      );
    });

    afterEach(() => {
      (HTMLCanvasElement.prototype.getContext as jest.Mock).mockImplementation(
        (type: string) => {
          if (type === "2d") {
            return {
              createImageData: jest.fn(() => ({
                data: new Uint8ClampedArray(80 * 60 * 4),
                width: 80,
                height: 60,
              })),
              putImageData: jest.fn(),
            };
          }
          return null;
        },
      );
    });

    it("debounces viewport resize handling with requestAnimationFrame", async () => {
      let rafCallbacks: Array<FrameRequestCallback> = [];
      const originalRaf = global.requestAnimationFrame;
      const originalCaf = global.cancelAnimationFrame;

      (global.requestAnimationFrame as jest.Mock).mockImplementation((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

      render(<HeatDiffusionViewer width={320} height={200} />);

      // Reset mock counts from mount
      mockGl.deleteTexture.mockClear();
      mockGl.deleteFramebuffer.mockClear();

      rafCallbacks = [];

      // Rapidly dispatch multiple resize events (dragging window corner)
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("resize"));
      });

      // cancelAnimationFrame should have cancelled earlier pending resize frames
      expect(global.cancelAnimationFrame).toHaveBeenCalled();

      // Execute only the latest debounced RAF callback
      const latestCb = rafCallbacks[rafCallbacks.length - 1];
      if (latestCb) {
        await act(async () => {
          latestCb(16);
        });
      }

      // Old textures and framebuffers were deleted before allocating new dimensions
      expect(mockGl.deleteTexture).toHaveBeenCalled();
      expect(mockGl.deleteFramebuffer).toHaveBeenCalled();

      global.requestAnimationFrame = originalRaf;
      global.cancelAnimationFrame = originalCaf;
    });

    it("listens to webglcontextlost event, calls preventDefault(), and stops rendering", async () => {
      render(<HeatDiffusionViewer width={320} height={200} />);
      const canvas = screen.getByLabelText(/Venue heat diffusion canvas/i);

      const lostEvent = new Event("webglcontextlost", {
        cancelable: true,
        bubbles: true,
      });
      const preventDefaultSpy = jest.spyOn(lostEvent, "preventDefault");

      await act(async () => {
        canvas.dispatchEvent(lostEvent);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(
        screen.getByTestId("webgl-context-lost-warning"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/WebGL context lost — recovering/i),
      ).toBeInTheDocument();
    });

    it("listens to webglcontextrestored event and recovers state gracefully", async () => {
      render(<HeatDiffusionViewer width={320} height={200} />);
      const canvas = screen.getByLabelText(/Venue heat diffusion canvas/i);

      const lostEvent = new Event("webglcontextlost", { cancelable: true });
      await act(async () => {
        canvas.dispatchEvent(lostEvent);
      });

      expect(
        screen.getByTestId("webgl-context-lost-warning"),
      ).toBeInTheDocument();

      // Clear mock counts to track restoration allocations
      mockGl.createTexture.mockClear();
      mockGl.createFramebuffer.mockClear();

      const restoredEvent = new Event("webglcontextrestored", {
        bubbles: true,
      });
      await act(async () => {
        canvas.dispatchEvent(restoredEvent);
      });

      // WebGL textures and framebuffers reallocated upon restore
      expect(mockGl.createTexture).toHaveBeenCalledTimes(2);
      expect(mockGl.createFramebuffer).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByTestId("webgl-context-lost-warning"),
      ).not.toBeInTheDocument();
    });
  });
    describe("Sanitization and Boundary Clamping", () => {
      const createMockGl = () => ({
        createTexture: jest.fn(() => ({})),
        deleteTexture: jest.fn(),
        bindTexture: jest.fn(),
        texImage2D: jest.fn(),
        texParameteri: jest.fn(),
        createFramebuffer: jest.fn(() => ({})),
        deleteFramebuffer: jest.fn(),
        bindFramebuffer: jest.fn(),
        framebufferTexture2D: jest.fn(),
        createRenderbuffer: jest.fn(() => ({})),
        deleteRenderbuffer: jest.fn(),
        viewport: jest.fn(),
        TEXTURE_2D: 0x0de1,
        FRAMEBUFFER: 0x8d40,
        COLOR_ATTACHMENT0: 0x8ce0,
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        NEAREST: 0x2600,
        CLAMP_TO_EDGE: 0x812f,
      } as unknown as WebGLRenderingContext);

      it("sanitizes zero, negative, and NaN dimensions in allocateWebGLBuffers", () => {
        const mockGl = createMockGl() as unknown as WebGLRenderingContext;
        allocateWebGLBuffers(mockGl, 0, -50);
        expect(mockGl.texImage2D).toHaveBeenCalledWith(
          mockGl.TEXTURE_2D,
          0,
          mockGl.RGBA,
          1,
          1,
          0,
          mockGl.RGBA,
          mockGl.UNSIGNED_BYTE,
          null,
        );

        (mockGl.texImage2D as jest.Mock).mockClear();
        allocateWebGLBuffers(mockGl, NaN, Number.POSITIVE_INFINITY);
        expect(mockGl.texImage2D).toHaveBeenCalledWith(
          mockGl.TEXTURE_2D,
          0,
          mockGl.RGBA,
          1,
          1,
          0,
          mockGl.RGBA,
          mockGl.UNSIGNED_BYTE,
          null,
        );
      });

      it("clamps canvas mouse click coordinates when bounding rect has zero width/height", () => {
        render(
          <HeatDiffusionViewer
            width={320}
            height={200}
            gridWidth={80}
            gridHeight={60}
          />,
        );
        const canvas = screen.getByLabelText(/Venue heat diffusion canvas/i);

        jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

        fireEvent.mouseDown(canvas, { clientX: 100, clientY: 50 });
        expect(
          screen.getAllByRole("button", { name: /Coffee Machine heat node/i }).length,
        ).toBeGreaterThanOrEqual(1);
      });

      it("clamps dragged node position within grid bounds and handles negative coordinates", () => {
        render(
          <HeatDiffusionViewer
            width={320}
            height={200}
            gridWidth={80}
            gridHeight={60}
          />,
        );
        const canvas = screen.getByLabelText(/Venue heat diffusion canvas/i);

        jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
          width: 800,
          height: 600,
          top: 0,
          left: 0,
          bottom: 600,
          right: 800,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

        // Mouse down near node #1 (x: 16, y: 15) -> clientX: 160, clientY: 150
        fireEvent.mouseDown(canvas, { clientX: 160, clientY: 150 });
        // Drag far beyond grid boundaries into negative space
        fireEvent.mouseMove(canvas, { clientX: -999, clientY: -999 });
        fireEvent.mouseUp(canvas);

        const nodeBtn = screen.getAllByRole("button", {
          name: /Coffee Machine heat node/i,
        })[0];
        expect(nodeBtn).toHaveStyle({ left: "0%", top: "0%" });
      });
  });
});
