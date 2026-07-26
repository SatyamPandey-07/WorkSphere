/**
 * Unit tests for VenueGodRays / useGodRaysRenderer WebGL context-loss recovery (#1288).
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useGodRaysRenderer } from "../../hooks/useGodRaysRenderer";

function createMockGl(): WebGL2RenderingContext {
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    COLOR_BUFFER_BIT: 0x4000,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    TRIANGLES: 0x0004,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    createShader: jest.fn(() => ({})),
    shaderSource: jest.fn(),
    compileShader: jest.fn(),
    getShaderParameter: jest.fn(() => true),
    getShaderInfoLog: jest.fn(() => ""),
    deleteShader: jest.fn(),
    createProgram: jest.fn(() => ({})),
    attachShader: jest.fn(),
    linkProgram: jest.fn(),
    getProgramParameter: jest.fn(() => true),
    getProgramInfoLog: jest.fn(() => ""),
    deleteProgram: jest.fn(),
    useProgram: jest.fn(),
    createVertexArray: jest.fn(() => ({})),
    createBuffer: jest.fn(() => ({})),
    bindVertexArray: jest.fn(),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    getAttribLocation: jest.fn(() => 0),
    enableVertexAttribArray: jest.fn(),
    vertexAttribPointer: jest.fn(),
    getUniformLocation: jest.fn(() => ({})),
    deleteBuffer: jest.fn(),
    deleteVertexArray: jest.fn(),
    viewport: jest.fn(),
    clearColor: jest.fn(),
    clear: jest.fn(),
    enable: jest.fn(),
    blendFunc: jest.fn(),
    uniform2f: jest.fn(),
    uniform1f: jest.fn(),
    drawArrays: jest.fn(),
    isContextLost: jest.fn(() => false),
  };
  return gl as unknown as WebGL2RenderingContext;
}

describe("useGodRaysRenderer WebGL context loss (#1288)", () => {
  let mockGl: WebGL2RenderingContext;
  let rafCallbacks: FrameRequestCallback[];
  let nextRafId: number;

  beforeEach(() => {
    mockGl = createMockGl();
    rafCallbacks = [];
    nextRafId = 1;

    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => mockGl as any);

    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return nextRafId++;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      rafCallbacks = [];
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    const banner = document.getElementById("webgl-recovery-banner");
    if (banner?.parentNode) banner.parentNode.removeChild(banner);
  });

  it("sets context-lost flag and stops scheduling frames on webglcontextlost", async () => {
    const { result } = renderHook(() =>
      useGodRaysRenderer({ sunX: 0.5, sunY: 0.5, animate: true }),
    );

    await waitFor(() => {
      expect(result.current.canvas).not.toBeNull();
    });

    const canvas = result.current.canvas!;
    expect(result.current.isContextLost).toBe(false);
    expect(rafCallbacks.length).toBeGreaterThan(0);

    act(() => {
      const lost = new Event("webglcontextlost", {
        cancelable: true,
        bubbles: true,
      });
      canvas.dispatchEvent(lost);
    });

    await waitFor(() => {
      expect(result.current.isContextLost).toBe(true);
    });

    const pendingAfterLoss = rafCallbacks.length;
    act(() => {
      // Drain any leftover callbacks — they must not re-queue while lost
      const pending = [...rafCallbacks];
      rafCallbacks = [];
      for (const cb of pending) {
        cb(performance.now());
      }
    });

    expect(result.current.isContextLost).toBe(true);
    expect(rafCallbacks.length).toBe(0);
    expect(pendingAfterLoss).toBeGreaterThanOrEqual(0);
  });

  it("clears context-lost flag and re-inits GL on webglcontextrestored", async () => {
    const { result } = renderHook(() =>
      useGodRaysRenderer({ sunX: 0.5, sunY: 0.5, animate: true }),
    );

    await waitFor(() => {
      expect(result.current.canvas).not.toBeNull();
    });

    const canvas = result.current.canvas!;

    act(() => {
      canvas.dispatchEvent(
        new Event("webglcontextlost", { cancelable: true, bubbles: true }),
      );
    });

    await waitFor(() => {
      expect(result.current.isContextLost).toBe(true);
    });

    const createProgramCalls = (mockGl.createProgram as jest.Mock).mock.calls
      .length;

    act(() => {
      canvas.dispatchEvent(
        new Event("webglcontextrestored", { cancelable: true, bubbles: true }),
      );
    });

    await waitFor(() => {
      expect(result.current.isContextLost).toBe(false);
    });

    // Shaders / program re-created on restore
    expect(
      (mockGl.createProgram as jest.Mock).mock.calls.length,
    ).toBeGreaterThan(createProgramCalls);
    expect(rafCallbacks.length).toBeGreaterThan(0);
  });
});
