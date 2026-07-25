/**
 * Unit tests for WebGPUFloorPlanRenderer — event listener cleanup on destroy().
 *
 * Verifies that all 9 canvas interaction listeners registered in
 * setupInteraction() are properly removed when destroy() is called,
 * preventing cumulative memory leaks.
 */

import { WebGPUFloorPlanRenderer } from "@/lib/webgpu/floorPlanRenderer";

// Stub GPUBufferUsage / GPUTextureUsage constants used at module level
Object.defineProperty(global, "GPUBufferUsage", { value: undefined });
Object.defineProperty(global, "GPUTextureUsage", { value: undefined });

function createMockCanvas() {
  const listeners: Record<string, EventListenerOrEventListenerObject[]> = {};

  const canvas = {
    addEventListener: jest.fn(
      (
        type: string,
        handler: EventListenerOrEventListenerObject,
        _options?: unknown,
      ) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(handler);
      },
    ),
    removeEventListener: jest.fn(
      (
        type: string,
        handler: EventListenerOrEventListenerObject,
        _options?: unknown,
      ) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter((h) => h !== handler);
        }
      },
    ),
    getContext: jest.fn(() => null),
    width: 800,
    height: 600,
    _listeners: listeners,
  };

  return canvas as unknown as HTMLCanvasElement & {
    _listeners: typeof listeners;
  };
}

describe("WebGPUFloorPlanRenderer — destroy() event listener cleanup", () => {
  let canvas: ReturnType<typeof createMockCanvas>;
  let renderer: WebGPUFloorPlanRenderer;

  beforeEach(() => {
    // Mock document.addEventListener / removeEventListener for visibility handler
    jest.spyOn(document, "addEventListener").mockImplementation(() => {});
    jest.spyOn(document, "removeEventListener").mockImplementation(() => {});

    canvas = createMockCanvas();
    renderer = new WebGPUFloorPlanRenderer(canvas);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const CANVAS_EVENTS = [
    "mousedown",
    "mousemove",
    "mouseup",
    "mouseleave",
    "wheel",
    "touchstart",
    "touchmove",
    "touchend",
  ] as const;

  it("registers all 8 canvas interaction listeners on construction", () => {
    for (const event of CANVAS_EVENTS) {
      // Some listeners are registered with an options object, others without —
      // so we only assert on event type and handler function.
      const calls = (canvas.addEventListener as jest.Mock).mock.calls;
      const matched = calls.some(
        ([type, handler]) => type === event && typeof handler === "function",
      );
      expect(matched).toBe(true);
    }
  });

  it("calls removeEventListener for every canvas event type on destroy()", () => {
    renderer.destroy();

    for (const event of CANVAS_EVENTS) {
      expect(canvas.removeEventListener).toHaveBeenCalledWith(
        event,
        expect.any(Function),
      );
    }
  });

  it("removes exactly the same handler reference that was added", () => {
    // Each listener array should have exactly one entry after construction
    for (const event of CANVAS_EVENTS) {
      expect(canvas._listeners[event]).toHaveLength(1);
    }

    renderer.destroy();

    // After destroy() all listener arrays should be empty (reference matched)
    for (const event of CANVAS_EVENTS) {
      expect(canvas._listeners[event] ?? []).toHaveLength(0);
    }
  });

  it("removes the visibilitychange listener from document on destroy()", () => {
    renderer.destroy();
    expect(document.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });

  it("does not throw when destroy() is called multiple times", () => {
    expect(() => {
      renderer.destroy();
      renderer.destroy();
    }).not.toThrow();
  });
});
