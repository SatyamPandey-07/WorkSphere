import { WebGLHeatmapRenderer } from "@/lib/webgl/webglHeatmapRenderer";
import {
  HEATMAP_VERTEX_SHADER,
  HEATMAP_FRAGMENT_SHADER,
} from "@/shaders/heatmapShaders";

describe("WebGLHeatmapRenderer Engine & Shaders (#818)", () => {
  let canvas: HTMLCanvasElement;
  let mockGl: any;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    mockGl = {
      enable: jest.fn(),
      blendFunc: jest.fn(),
      createShader: jest.fn(() => ({})),
      shaderSource: jest.fn(),
      compileShader: jest.fn(),
      getShaderParameter: jest.fn(() => true),
      createProgram: jest.fn(() => ({})),
      attachShader: jest.fn(),
      linkProgram: jest.fn(),
      getProgramParameter: jest.fn(() => true),
      useProgram: jest.fn(),
      getAttribLocation: jest.fn(() => 0),
      getUniformLocation: jest.fn(() => ({})),
      createBuffer: jest.fn(() => ({})),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      bufferSubData: jest.fn(),
      viewport: jest.fn(),
      clearColor: jest.fn(),
      clear: jest.fn(),
      uniform1f: jest.fn(),
      uniform2f: jest.fn(),
      enableVertexAttribArray: jest.fn(),
      vertexAttribPointer: jest.fn(),
      drawArrays: jest.fn(),
      deleteProgram: jest.fn(),
      deleteBuffer: jest.fn(),
      COLOR_BUFFER_BIT: 0x4000,
      POINTS: 0x0000,
      SRC_ALPHA: 0x0302,
      ONE: 1,
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82,
      ARRAY_BUFFER: 0x8892,
      DYNAMIC_DRAW: 0x88e8,
      FLOAT: 0x1406,
    };

    HTMLCanvasElement.prototype.getContext = jest.fn((type: string) => {
      if (type === "webgl2" || type === "webgl") return mockGl;
      return null;
    }) as any;
  });

  test("defines high-performance GLSL vertex and fragment shaders", () => {
    expect(HEATMAP_VERTEX_SHADER).toContain("a_position");
    expect(HEATMAP_VERTEX_SHADER).toContain("a_intensity");
    expect(HEATMAP_FRAGMENT_SHADER).toContain("gl_PointCoord");
    expect(HEATMAP_FRAGMENT_SHADER).toContain("getHeatColor");
  });

  test("initializes WebGL buffers and shader programs", () => {
    const renderer = new WebGLHeatmapRenderer(canvas, {
      opacity: 0.8,
      blur: 1.2,
    });
    expect(mockGl.createProgram).toHaveBeenCalled();
    expect(mockGl.createBuffer).toHaveBeenCalled();
    expect(mockGl.enable).toHaveBeenCalledWith(mockGl.BLEND);
    renderer.destroy();
  });

  test("uploads telemetry points to GPU Float32Array buffer", () => {
    const renderer = new WebGLHeatmapRenderer(canvas);
    const points = [
      { x: 100, y: 150, intensity: 0.8, radius: 25 },
      { x: 200, y: 250, intensity: 0.5, radius: 30 },
    ];

    renderer.updatePoints(points);
    expect(mockGl.bindBuffer).toHaveBeenCalledWith(
      mockGl.ARRAY_BUFFER,
      expect.anything(),
    );
    expect(mockGl.bufferSubData).toHaveBeenCalled();
    renderer.destroy();
  });

  test("executes drawArrays render pass with viewport dimensions and zoom level", () => {
    const renderer = new WebGLHeatmapRenderer(canvas);
    renderer.updatePoints([{ x: 50, y: 50, intensity: 0.9, radius: 20 }]);
    renderer.render(800, 600, 14);

    expect(mockGl.viewport).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(mockGl.drawArrays).toHaveBeenCalledWith(mockGl.POINTS, 0, 1);
    renderer.destroy();
  });

  test("cleans up resources on destroy()", () => {
    const renderer = new WebGLHeatmapRenderer(canvas);
    renderer.destroy();
    expect(mockGl.deleteProgram).toHaveBeenCalled();
    expect(mockGl.deleteBuffer).toHaveBeenCalled();
  });
});
