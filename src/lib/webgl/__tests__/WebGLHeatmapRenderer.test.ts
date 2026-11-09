import { WebGLHeatmapRenderer } from "../WebGLHeatmapRenderer";

// Mock WebGL context
const createMockGL = () => ({
  enable: jest.fn(),
  blendFunc: jest.fn(),
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
  getAttribLocation: jest.fn((_program: any, name: string) => (name === "a_position" ? 0 : 1)),
  getUniformLocation: jest.fn(() => ({})),
  uniform1i: jest.fn(),
  uniform1f: jest.fn(),
  uniform2f: jest.fn(),
  createBuffer: jest.fn(() => ({})),
  bindBuffer: jest.fn(),
  bufferData: jest.fn(),
  bufferSubData: jest.fn(),
  deleteBuffer: jest.fn(),
  viewport: jest.fn(),
  clearColor: jest.fn(),
  clear: jest.fn(),
  enableVertexAttribArray: jest.fn(),
  vertexAttribPointer: jest.fn(),
  drawArrays: jest.fn(),
  COLOR_BUFFER_BIT: 16384,
  VERTEX_SHADER: 35633,
  FRAGMENT_SHADER: 35632,
  SRC_ALPHA: 770,
  ONE: 1,
  ARRAY_BUFFER: 34962,
  DYNAMIC_DRAW: 35048,
  FLOAT: 5126,
  POINTS: 0,
});

describe("WebGLHeatmapRenderer", () => {
  let canvas: HTMLCanvasElement;
  let mockGL: ReturnType<typeof createMockGL>;

  beforeEach(() => {
    mockGL = createMockGL();
    canvas = document.createElement("canvas");
    jest.spyOn(canvas, "getContext").mockReturnValue(mockGL as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("initializes WebGL context and sets initial palette", () => {
    const renderer = new WebGLHeatmapRenderer(canvas, { palette: "neon" });
    expect(renderer.getPalette()).toBe("neon");
    expect(mockGL.useProgram).toHaveBeenCalled();
  });

  it("updates points buffer without throwing errors", () => {
    const renderer = new WebGLHeatmapRenderer(canvas);
    const points = [
      { x: 100, y: 200, intensity: 0.8 },
      { x: 300, y: 400, intensity: 0.5, radius: 30 },
    ];

    renderer.updatePoints(points);
    expect(mockGL.bufferSubData).toHaveBeenCalled();
  });

  it("switches color palette dynamically", () => {
    const renderer = new WebGLHeatmapRenderer(canvas, { palette: "thermal" });
    renderer.setPalette("grayscale");
    expect(renderer.getPalette()).toBe("grayscale");
    expect(mockGL.uniform1i).toHaveBeenCalled();
  });

  it("renders points onto canvas viewports", () => {
    const renderer = new WebGLHeatmapRenderer(canvas);
    renderer.updatePoints([{ x: 50, y: 50, intensity: 1.0 }]);
    renderer.render(800, 600, 1.5);

    expect(mockGL.viewport).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(mockGL.drawArrays).toHaveBeenCalledWith(mockGL.POINTS, 0, 1);
  });

  it("destroys resources on cleanup", () => {
    const renderer = new WebGLHeatmapRenderer(canvas);
    renderer.destroy();
    expect(mockGL.deleteProgram).toHaveBeenCalled();
    expect(mockGL.deleteBuffer).toHaveBeenCalled();
  });
});
