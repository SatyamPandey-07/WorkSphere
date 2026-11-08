import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useOffscreenHeatmap } from "@/hooks/useOffscreenHeatmap";

// Mock Worker
const postMessageMock = jest.fn();
const terminateMock = jest.fn();

class MockWorker {
  postMessage = postMessageMock;
  terminate = terminateMock;
  addEventListener = jest.fn();
  removeEventListener = jest.fn();
}

// Mock OffscreenCanvas
class MockOffscreenCanvas {
  getContext = jest.fn().mockReturnValue({});
}

const transferControlToOffscreenMock = jest.fn(
  () => new MockOffscreenCanvas() as unknown as OffscreenCanvas,
);

function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  Object.defineProperty(canvas, "transferControlToOffscreen", {
    value: transferControlToOffscreenMock,
    writable: true,
    configurable: true,
  });
  return canvas;
}

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).Worker = MockWorker;
  (global as any).OffscreenCanvas = MockOffscreenCanvas;
});

describe("useOffscreenHeatmap", () => {
  it("creates a worker on mount when OffscreenCanvas is available", () => {
    const canvasRef = { current: createMockCanvas() };
    renderHook(() => useOffscreenHeatmap(canvasRef as any, { gridW: 10, gridH: 10 }));
    expect(transferControlToOffscreenMock).toHaveBeenCalledTimes(1);
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "INIT" }),
      expect.any(Array),
    );
  });

  it("terminates the worker on unmount", () => {
    const canvasRef = { current: createMockCanvas() };
    const { unmount } = renderHook(() =>
      useOffscreenHeatmap(canvasRef as any, { gridW: 10, gridH: 10 }),
    );
    unmount();
    expect(terminateMock).toHaveBeenCalledTimes(1);
  });

  it("calls RENDER message when renderDensity is invoked", () => {
    const canvasRef = { current: createMockCanvas() };
    const { result } = renderHook(() =>
      useOffscreenHeatmap(canvasRef as any, { gridW: 4, gridH: 4 }),
    );

    const density = new Float32Array(16).fill(0.5);
    act(() => {
      result.current.renderDensity(density);
    });

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "RENDER",
        gridW: 4,
        gridH: 4,
      }),
      expect.any(Array),
    );
  });

  it("does not crash when canvas is null", () => {
    const canvasRef = { current: null };
    expect(() => {
      renderHook(() =>
        useOffscreenHeatmap(canvasRef as any, { gridW: 10, gridH: 10 }),
      );
    }).not.toThrow();
  });

  it("does not crash when OffscreenCanvas is not available", () => {
    (global as any).OffscreenCanvas = undefined;
    const canvasRef = { current: createMockCanvas() };
    expect(() => {
      renderHook(() =>
        useOffscreenHeatmap(canvasRef as any, { gridW: 10, gridH: 10 }),
      );
    }).not.toThrow();
  });
});
