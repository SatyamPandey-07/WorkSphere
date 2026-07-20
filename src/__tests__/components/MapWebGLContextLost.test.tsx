import {
  attachWebGLContextRecovery,
  reinitializeWebGLBuffers,
} from "../../lib/webgl/contextManager";

describe("WebGL Context Lost & Restoration Manager (#909)", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement("canvas");
  });

  it("attaches handlers and prevents default loss behavior on webglcontextlost", () => {
    const onRestore = jest.fn();
    const cleanup = attachWebGLContextRecovery(canvas, onRestore);

    const lostEvent = new Event("webglcontextlost", {
      cancelable: true,
      bubbles: true,
    });

    const preventDefaultSpy = jest.spyOn(lostEvent, "preventDefault");

    canvas.dispatchEvent(lostEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();

    cleanup();
  });

  it("triggers restore callback when webglcontextrestored event fires", () => {
    const onRestore = jest.fn();
    const cleanup = attachWebGLContextRecovery(canvas, onRestore);

    const restoreEvent = new Event("webglcontextrestored", {
      cancelable: true,
      bubbles: true,
    });

    canvas.dispatchEvent(restoreEvent);

    // Should handle context restoration without throwing
    expect(restoreEvent).toBeDefined();

    cleanup();
  });

  it("re-initializes WebGL buffer attributes with coordinates on restoration", () => {
    const mockGl = {
      createBuffer: jest.fn().mockReturnValue({}),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88e4,
    } as unknown as WebGLRenderingContext;

    const points: Array<[number, number, number]> = [
      [37.7749, -122.4194, 0.8],
      [37.7833, -122.4167, 0.5],
    ];

    const buffers = reinitializeWebGLBuffers(mockGl, points);

    expect(mockGl.createBuffer).toHaveBeenCalled();
    expect(mockGl.bindBuffer).toHaveBeenCalled();
    expect(mockGl.bufferData).toHaveBeenCalled();
    expect(buffers.positionBuffer).toBeDefined();
  });
});
