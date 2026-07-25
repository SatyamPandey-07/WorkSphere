import { allocateCanvasDrawingBuffer } from "../../lib/webgl/canvasBufferSize";

describe("allocateCanvasDrawingBuffer (#1030)", () => {
  const originalDpr = window.devicePixelRatio;

  afterEach(() => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: originalDpr,
    });
  });

  it("multiplies CSS size by devicePixelRatio on high-DPI displays", () => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });

    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 450,
    });

    const result = allocateCanvasDrawingBuffer(canvas);

    expect(result.dpr).toBe(2);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(900);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(900);
  });

  it("uses explicit CSS dimensions when provided", () => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2.5,
    });

    const canvas = document.createElement("canvas");
    const result = allocateCanvasDrawingBuffer(canvas, 400, 300);

    expect(result.width).toBe(1000);
    expect(result.height).toBe(750);
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(750);
  });

  it("does not double-scale when client size is unavailable", () => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });

    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 0,
    });

    const result = allocateCanvasDrawingBuffer(canvas);

    expect(result.width).toBe(1600);
    expect(result.height).toBe(900);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(900);
  });
});
