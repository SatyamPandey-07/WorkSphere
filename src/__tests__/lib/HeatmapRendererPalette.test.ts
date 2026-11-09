import { HeatmapRenderer, type HeatmapPaletteMode } from "@/core/webgl/HeatmapRenderer";

describe("HeatmapRenderer Palette Theme Switcher (#5390)", () => {
  let canvas: HTMLCanvasElement;
  let mockGl: any;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    mockGl = {
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
      getUniformLocation: jest.fn((_, name) => ({ name })),
      createBuffer: jest.fn(() => ({})),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      enableVertexAttribArray: jest.fn(),
      vertexAttribPointer: jest.fn(),
      uniformMatrix3fv: jest.fn(),
      uniform2fv: jest.fn(),
      uniform1f: jest.fn(),
      uniform1i: jest.fn(),
      clearColor: jest.fn(),
      clear: jest.fn(),
      enable: jest.fn(),
      blendFunc: jest.fn(),
      drawArrays: jest.fn(),
      deleteBuffer: jest.fn(),
      deleteProgram: jest.fn(),
      deleteShader: jest.fn(),
      viewport: jest.fn(),
      COLOR_BUFFER_BIT: 0x4000,
      POINTS: 0x0000,
      SRC_ALPHA: 0x0302,
      ONE_MINUS_SRC_ALPHA: 0x0303,
      BLEND: 0x0be2,
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82,
      ARRAY_BUFFER: 0x8892,
      DYNAMIC_DRAW: 0x88e8,
      FLOAT: 0x1406,
    };

    HTMLCanvasElement.prototype.getContext = jest.fn((type: string) => {
      if (type === "webgl") return mockGl;
      return null;
    }) as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("initializes with default 'thermal' palette (mode 0)", () => {
    const renderer = new HeatmapRenderer(canvas);
    expect(renderer.getPalette()).toBe("thermal");
    expect(mockGl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_paletteMode" }),
      0
    );
    renderer.destroy();
  });

  it("initializes with custom initial palette", () => {
    const renderer = new HeatmapRenderer(canvas, "neon");
    expect(renderer.getPalette()).toBe("neon");
    expect(mockGl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_paletteMode" }),
      1
    );
    renderer.destroy();
  });

  it("switches to Cyber Neon (mode 1) and Accessible Grayscale (mode 2) dynamically without rebuilding WebGL context", () => {
    const renderer = new HeatmapRenderer(canvas);

    // Initial check
    expect(mockGl.createProgram).toHaveBeenCalledTimes(1);

    // Switch to Neon
    renderer.setPalette("neon");
    expect(renderer.getPalette()).toBe("neon");
    expect(mockGl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_paletteMode" }),
      1
    );
    // Crucial: WebGL program must not be recreated
    expect(mockGl.createProgram).toHaveBeenCalledTimes(1);

    // Switch to Accessible Grayscale
    renderer.setPalette("grayscale");
    expect(renderer.getPalette()).toBe("grayscale");
    expect(mockGl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_paletteMode" }),
      2
    );
    expect(mockGl.createProgram).toHaveBeenCalledTimes(1);

    // Switch back to Thermal
    renderer.setPalette("thermal");
    expect(renderer.getPalette()).toBe("thermal");
    expect(mockGl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_paletteMode" }),
      0
    );
    expect(mockGl.createProgram).toHaveBeenCalledTimes(1);

    renderer.destroy();
  });

  it("uploads palette uniform during render pass", () => {
    const renderer = new HeatmapRenderer(canvas, "grayscale");
    const dataPoints = [{ x: 10, y: 20, value: 85 }];
    const projectionMatrix = new Float32Array(9);

    renderer.render(dataPoints, [0, 0], [100, 100], projectionMatrix);

    expect(mockGl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_paletteMode" }),
      2
    );
    expect(mockGl.drawArrays).toHaveBeenCalledWith(mockGl.POINTS, 0, 1);

    renderer.destroy();
  });
});
