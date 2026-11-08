import { WebGLContextRecoveryManager } from "../../lib/webgl/WebGLContextRecoveryManager";

describe("WebGLContextRecoveryManager", () => {
  let canvas: HTMLCanvasElement;
  let onRestore: jest.Mock;
  let onLost: jest.Mock;

  beforeEach(() => {
    // Clear document body and recreate canvas for clean tests
    document.body.innerHTML = "";
    WebGLContextRecoveryManager.reset();

    canvas = document.createElement("canvas");
    onRestore = jest.fn();
    onLost = jest.fn();
  });

  afterEach(() => {
    // Clean up banner after each test
    const banner = document.getElementById("webgl-recovery-banner");
    if (banner && banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }
  });

  it("should prevent default behavior on webglcontextlost event and show recovery banner", () => {
    const manager = new WebGLContextRecoveryManager(canvas, {
      onRestore,
      onLost,
    });

    const lostEvent = new Event("webglcontextlost", {
      cancelable: true,
      bubbles: true,
    });
    const preventDefaultSpy = jest.spyOn(lostEvent, "preventDefault");

    canvas.dispatchEvent(lostEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(onLost).toHaveBeenCalled();

    // Verify banner exists in DOM
    const banner = document.getElementById("webgl-recovery-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Recovering WebGL context");

    manager.destroy();
  });

  it("should execute onRestore callback when webglcontextrestored is fired and show success state", () => {
    // Mock getContext to avoid throwing in jsdom environment
    const mockContext = {
      viewport: jest.fn(),
    } as any;
    jest.spyOn(canvas, "getContext").mockReturnValue(mockContext);
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 450,
    });
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });

    const manager = new WebGLContextRecoveryManager(canvas, { onRestore });

    // Mark as lost first so it transitions to success correctly
    const lostEvent = new Event("webglcontextlost", {
      cancelable: true,
      bubbles: true,
    });
    canvas.dispatchEvent(lostEvent);

    const restoreEvent = new Event("webglcontextrestored", {
      cancelable: true,
      bubbles: true,
    });
    canvas.dispatchEvent(restoreEvent);

    expect(mockContext.viewport).toHaveBeenCalledWith(0, 0, 1600, 900);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(900);
    expect(onRestore).toHaveBeenCalledWith(mockContext);

    const banner = document.getElementById("webgl-recovery-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("restored successfully");

    manager.destroy();
  });

  it("should remove event listeners and clean up active recoveries upon destroy", () => {
    const manager = new WebGLContextRecoveryManager(canvas, { onRestore });

    const lostEvent = new Event("webglcontextlost", {
      cancelable: true,
      bubbles: true,
    });
    canvas.dispatchEvent(lostEvent);

    expect(document.getElementById("webgl-recovery-banner")).not.toBeNull();

    // Destroy should remove it
    manager.destroy();

    // Check if the banner gets hidden/removed
    const banner = document.getElementById("webgl-recovery-banner");
    // It should have opacity 0 or be deleted
    if (banner) {
      expect(banner.style.opacity).toBe("0");
    } else {
      expect(banner).toBeNull();
    }
  });

  it("should call preventDefault() synchronously before consumer callbacks during webglcontextlost", () => {
    let preventDefaultCalledFirst = false;
    const lostEvent = new Event("webglcontextlost", {
      cancelable: true,
      bubbles: true,
    });

    const onLostSpy = jest.fn(() => {
      // Check if defaultPrevented is already set when onLost is invoked
      preventDefaultCalledFirst = lostEvent.defaultPrevented;
    });

    const manager = new WebGLContextRecoveryManager(canvas, {
      onRestore,
      onLost: onLostSpy,
    });

    canvas.dispatchEvent(lostEvent);

    expect(lostEvent.defaultPrevented).toBe(true);
    expect(onLostSpy).toHaveBeenCalledTimes(1);
    expect(preventDefaultCalledFirst).toBe(true);

    manager.destroy();
  });

  it("should handle rapid tab visibility changes with context loss and re-bind resources before render loop", () => {
    const executionOrder: string[] = [];

    const mockVBO = {} as WebGLBuffer;
    const mockTexture = {} as WebGLTexture;
    const mockContext = {
      viewport: jest.fn(),
      bindBuffer: jest.fn(() => executionOrder.push("bindBuffer:vbo")),
      bindTexture: jest.fn(() => executionOrder.push("bindTexture:tex")),
      ARRAY_BUFFER: 0x8892,
      TEXTURE_2D: 0x0de1,
    } as any;

    jest.spyOn(canvas, "getContext").mockReturnValue(mockContext);

    const renderLoop = {
      start: jest.fn(() => executionOrder.push("renderLoop:start")),
      stop: jest.fn(() => executionOrder.push("renderLoop:stop")),
    };

    const onRestoreWithBindings = jest.fn((gl: WebGLRenderingContext) => {
      executionOrder.push("onRestore:rebind");
      gl.bindBuffer(gl.ARRAY_BUFFER, mockVBO);
      gl.bindTexture(gl.TEXTURE_2D, mockTexture);
    });

    const manager = new WebGLContextRecoveryManager(canvas, {
      onRestore: onRestoreWithBindings,
      renderLoop,
    });

    // Simulate 3 rapid tab switching cycles (visible -> hidden -> visible)
    for (let cycle = 0; cycle < 3; cycle++) {
      executionOrder.length = 0;

      // User switches to background tab
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));

      // Background tab triggers context loss
      const lostEvent = new Event("webglcontextlost", { cancelable: true });
      canvas.dispatchEvent(lostEvent);

      expect(lostEvent.defaultPrevented).toBe(true);
      expect(manager.state).toBe("lost");
      expect(renderLoop.stop).toHaveBeenCalled();

      // User returns to foreground tab
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));

      // Browser restores WebGL context
      const restoreEvent = new Event("webglcontextrestored", { cancelable: true });
      canvas.dispatchEvent(restoreEvent);

      expect(manager.state).toBe("active");
      expect(onRestoreWithBindings).toHaveBeenCalled();

      // Ensure VBOs and textures were re-bound BEFORE the render loop was resumed
      expect(executionOrder).toEqual([
        "renderLoop:stop",
        "onRestore:rebind",
        "bindBuffer:vbo",
        "bindTexture:tex",
        "renderLoop:start",
      ]);
    }

    manager.destroy();
  });
});
