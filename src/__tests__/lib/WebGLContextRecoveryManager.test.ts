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
    const mockContext = {} as any;
    jest.spyOn(canvas, "getContext").mockReturnValue(mockContext);

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
});
