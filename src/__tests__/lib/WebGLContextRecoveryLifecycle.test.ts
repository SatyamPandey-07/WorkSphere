/**
 * Recovery lifecycle for lost WebGL contexts (#1729): render-loop pause /
 * resume, honest failure reporting, restore timeout, loss storms and the
 * accessible notification banner.
 */
import { WebGLContextRecoveryManager } from "@/lib/webgl/WebGLContextRecoveryManager";
import { attachWebGLContextRecovery } from "@/lib/webgl/contextManager";
import { WebGLHeatmapRenderer } from "@/lib/webgl/webglHeatmapRenderer";

const lose = (canvas: HTMLCanvasElement) => {
  const event = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(event);
  return event;
};
const restore = (canvas: HTMLCanvasElement) =>
  canvas.dispatchEvent(new Event("webglcontextrestored"));

const banner = () => document.getElementById("webgl-recovery-banner");
const bannerText = () => document.getElementById("webgl-recovery-text")?.textContent ?? "";
const button = (label: string) =>
  Array.from(banner()?.querySelectorAll("button") ?? []).find((b) => b.textContent === label);

function makeCanvas(gl: unknown = { viewport: jest.fn() }) {
  const canvas = document.createElement("canvas");
  jest.spyOn(canvas, "getContext").mockReturnValue(gl as RenderingContext);
  return canvas;
}

const managers: WebGLContextRecoveryManager[] = [];
function track(m: WebGLContextRecoveryManager) {
  managers.push(m);
  return m;
}

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = "";
  WebGLContextRecoveryManager.reset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  managers.splice(0).forEach((m) => m.destroy());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("render loop lifecycle", () => {
  it("pauses the loop on loss and resumes it only after re-initialization", () => {
    const calls: string[] = [];
    const canvas = makeCanvas();
    const manager = track(
      new WebGLContextRecoveryManager(canvas, {
        onLost: () => calls.push("onLost"),
        onRestore: () => calls.push("onRestore"),
        renderLoop: { start: () => calls.push("start"), stop: () => calls.push("stop") },
      }),
    );

    lose(canvas);
    expect(calls).toEqual(["stop", "onLost"]);
    expect(manager.state).toBe("lost");

    restore(canvas);
    expect(calls).toEqual(["stop", "onLost", "onRestore", "start"]);
    expect(manager.state).toBe("active");
  });

  it("ignores a restore event that was not preceded by a loss", () => {
    const onRestore = jest.fn();
    const canvas = makeCanvas();
    track(new WebGLContextRecoveryManager(canvas, { onRestore }));
    restore(canvas);
    expect(onRestore).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
  });

  it("passes render-loop and failure options through attachWebGLContextRecovery", () => {
    const renderLoop = { start: jest.fn(), stop: jest.fn() };
    const canvas = makeCanvas();
    const detach = attachWebGLContextRecovery(canvas, jest.fn(), undefined, { renderLoop });
    lose(canvas);
    restore(canvas);
    expect(renderLoop.stop).toHaveBeenCalledTimes(1);
    expect(renderLoop.start).toHaveBeenCalledTimes(1);
    detach();
  });
});

describe("failure reporting", () => {
  it("reports failure instead of success when re-initialization throws", () => {
    const renderLoop = { start: jest.fn(), stop: jest.fn() };
    const onRestoreFailed = jest.fn();
    const canvas = makeCanvas();
    const manager = track(
      new WebGLContextRecoveryManager(canvas, {
        onRestore: () => {
          throw new Error("shader compile failed");
        },
        renderLoop,
        onRestoreFailed,
      }),
    );

    lose(canvas);
    restore(canvas);

    expect(onRestoreFailed).toHaveBeenCalledWith("error");
    expect(renderLoop.start).not.toHaveBeenCalled();
    expect(manager.state).toBe("failed");
    expect(bannerText()).toContain("couldn't be restored");
    expect(bannerText()).not.toContain("restored successfully");
    expect(banner()?.getAttribute("role")).toBe("alert");
  });

  it("reports failure when no context can be obtained after restore", () => {
    const onRestoreFailed = jest.fn();
    const canvas = makeCanvas(null);
    track(new WebGLContextRecoveryManager(canvas, { onRestore: jest.fn(), onRestoreFailed }));
    lose(canvas);
    restore(canvas);
    expect(onRestoreFailed).toHaveBeenCalledWith("error");
  });

  it("times out if the browser never restores, then still recovers if it does later", () => {
    const onRestoreFailed = jest.fn();
    const onRestore = jest.fn();
    const canvas = makeCanvas();
    const manager = track(
      new WebGLContextRecoveryManager(canvas, { onRestore, onRestoreFailed, restoreTimeoutMs: 5000 }),
    );

    lose(canvas);
    jest.advanceTimersByTime(4999);
    expect(onRestoreFailed).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onRestoreFailed).toHaveBeenCalledWith("timeout");
    expect(button("Reload")).toBeDefined();

    restore(canvas);
    expect(onRestore).toHaveBeenCalled();
    expect(manager.state).toBe("active");
    expect(bannerText()).toContain("restored successfully");
  });

  it("stops requesting restores after a storm of losses", () => {
    const onRestoreFailed = jest.fn();
    const canvas = makeCanvas();
    const manager = track(
      new WebGLContextRecoveryManager(canvas, {
        onRestore: jest.fn(),
        onRestoreFailed,
        maxLosses: 3,
        lossWindowMs: 60_000,
      }),
    );

    for (let i = 0; i < 3; i++) {
      expect(lose(canvas).defaultPrevented).toBe(true);
      restore(canvas);
    }
    const fourth = lose(canvas);
    expect(fourth.defaultPrevented).toBe(false);
    expect(onRestoreFailed).toHaveBeenCalledWith("loss-storm");
    expect(manager.state).toBe("failed");
  });

  it("only counts losses inside the window", () => {
    const onRestoreFailed = jest.fn();
    const canvas = makeCanvas();
    track(
      new WebGLContextRecoveryManager(canvas, {
        onRestore: jest.fn(),
        onRestoreFailed,
        maxLosses: 2,
        lossWindowMs: 1000,
      }),
    );

    for (let i = 0; i < 5; i++) {
      expect(lose(canvas).defaultPrevented).toBe(true);
      restore(canvas);
      jest.advanceTimersByTime(600);
    }
    expect(onRestoreFailed).not.toHaveBeenCalled();
  });

  it("does not fire a timeout after destroy()", () => {
    const onRestoreFailed = jest.fn();
    const canvas = makeCanvas();
    const manager = new WebGLContextRecoveryManager(canvas, { onRestore: jest.fn(), onRestoreFailed });
    lose(canvas);
    manager.destroy();
    jest.advanceTimersByTime(60_000);
    expect(onRestoreFailed).not.toHaveBeenCalled();
  });
});

describe("notification banner", () => {
  it("announces progress politely and hides the decorative spinner", () => {
    const canvas = makeCanvas();
    track(new WebGLContextRecoveryManager(canvas, { onRestore: jest.fn() }));
    lose(canvas);

    expect(banner()?.getAttribute("role")).toBe("status");
    expect(banner()?.getAttribute("aria-live")).toBe("polite");
    expect(document.getElementById("webgl-recovery-spinner")?.getAttribute("aria-hidden")).toBe("true");
    expect(button("Reload")).toBeDefined();
    expect((document.getElementById("webgl-recovery-actions") as HTMLElement).style.display).toBe("none");
  });

  it("stays in recovering state until every canvas is restored", () => {
    const a = makeCanvas();
    const b = makeCanvas();
    track(new WebGLContextRecoveryManager(a, { onRestore: jest.fn() }));
    track(new WebGLContextRecoveryManager(b, { onRestore: jest.fn() }));

    lose(a);
    lose(b);
    restore(a);
    expect(bannerText()).toContain("Recovering WebGL context");
    restore(b);
    expect(bannerText()).toContain("restored successfully");

    jest.advanceTimersByTime(2500 + 400);
    expect(banner()).toBeNull();
  });

  it("keeps a failure visible over other canvases' progress", () => {
    const ok = makeCanvas();
    const broken = makeCanvas();
    track(new WebGLContextRecoveryManager(ok, { onRestore: jest.fn() }));
    track(
      new WebGLContextRecoveryManager(broken, {
        onRestore: () => {
          throw new Error("boom");
        },
      }),
    );

    lose(ok);
    lose(broken);
    restore(broken);
    restore(ok);
    jest.advanceTimersByTime(5000);
    expect(bannerText()).toContain("couldn't be restored");
  });

  it("offers Reload and Dismiss on failure", () => {
    const reload = jest.spyOn(WebGLContextRecoveryManager, "reloadPage").mockImplementation(() => {});
    const canvas = makeCanvas(null);
    track(new WebGLContextRecoveryManager(canvas, { onRestore: jest.fn() }));
    lose(canvas);
    restore(canvas);

    expect(banner()?.style.pointerEvents).toBe("auto");
    button("Reload")!.click();
    expect(reload).toHaveBeenCalled();

    button("Dismiss")!.click();
    jest.advanceTimersByTime(400);
    expect(banner()).toBeNull();
  });
});

describe("WebGLHeatmapRenderer context restore", () => {
  function mockGl() {
    return {
      enable: jest.fn(), blendFunc: jest.fn(), createShader: jest.fn(() => ({})),
      shaderSource: jest.fn(), compileShader: jest.fn(), getShaderParameter: jest.fn(() => true),
      createProgram: jest.fn(() => ({})), attachShader: jest.fn(), linkProgram: jest.fn(),
      getProgramParameter: jest.fn(() => true), useProgram: jest.fn(),
      getAttribLocation: jest.fn(() => 0), getUniformLocation: jest.fn(() => ({})),
      createBuffer: jest.fn(() => ({})), bindBuffer: jest.fn(), bufferData: jest.fn(),
      bufferSubData: jest.fn(), viewport: jest.fn(), deleteProgram: jest.fn(), deleteBuffer: jest.fn(),
      VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82, ARRAY_BUFFER: 0x8892, DYNAMIC_DRAW: 0x88e8, SRC_ALPHA: 0x0302, ONE: 1,
    };
  }

  it("re-uploads the last points into the new buffer and asks the owner to redraw", () => {
    const gl = mockGl();
    const canvas = makeCanvas(gl);
    const onContextRestored = jest.fn();
    const renderer = new WebGLHeatmapRenderer(canvas, { onContextRestored });
    renderer.updatePoints([
      { x: 1, y: 2, intensity: 0.5 },
      { x: 3, y: 4, intensity: 0.9, radius: 10 },
    ]);
    const uploaded = gl.bufferSubData.mock.calls[0][2];

    gl.bufferSubData.mockClear();
    gl.createBuffer.mockClear();
    lose(canvas);
    restore(canvas);

    expect(gl.createBuffer).toHaveBeenCalled(); // fresh VBO
    expect(gl.deleteProgram).not.toHaveBeenCalled(); // stale handles dropped, not deleted
    expect(gl.bufferSubData).toHaveBeenCalledWith(gl.ARRAY_BUFFER, 0, uploaded);
    expect(onContextRestored).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it("surfaces a failed rebuild instead of claiming success", () => {
    const gl = mockGl();
    const canvas = makeCanvas(gl);
    const renderer = new WebGLHeatmapRenderer(canvas);
    gl.getProgramParameter.mockReturnValue(false); // link fails on the restored context

    lose(canvas);
    restore(canvas);

    expect(bannerText()).toContain("couldn't be restored");
    renderer.destroy();
  });
});
