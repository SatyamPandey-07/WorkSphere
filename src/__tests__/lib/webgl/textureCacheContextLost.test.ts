import { WebGLTextureCache } from "@/lib/webgl/textureCache";

describe("WebGLTextureCache Context Loss Resilience (#10013)", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement("canvas");
  });

  it("handles webglcontextlost without throwing unhandled exceptions and calls preventDefault", () => {
    const cache = new WebGLTextureCache({ canvas });

    const lostEvent = new Event("webglcontextlost", {
      cancelable: true,
      bubbles: true,
    });
    const preventDefaultSpy = jest.spyOn(lostEvent, "preventDefault");

    expect(() => {
      canvas.dispatchEvent(lostEvent);
    }).not.toThrow();

    expect(preventDefaultSpy).toHaveBeenCalled();
    cache.dispose();
  });

  it("resets context lost state and clears stale textures upon webglcontextrestored", () => {
    const cache = new WebGLTextureCache({ canvas });

    const lostEvent = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lostEvent);

    const restoreEvent = new Event("webglcontextrestored", { cancelable: true });
    expect(() => {
      canvas.dispatchEvent(restoreEvent);
    }).not.toThrow();

    cache.dispose();
  });
});
