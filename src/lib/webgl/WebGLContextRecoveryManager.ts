/**
 * WebGLContextRecoveryManager.ts
 *
 * Coordinates WebGL context lost / restored events for a canvas (#1649, #1729):
 *
 *  - Lost:     calls preventDefault() so the browser may restore the context,
 *              pauses the canvas's render loop and runs the consumer's teardown.
 *  - Restored: re-sizes the drawing buffer (high-DPI, #1030), lets the consumer
 *              rebuild shaders / buffers / textures, then resumes the render loop.
 *  - Failure:  if the context never comes back (restoreTimeoutMs), re-init throws,
 *              or the GPU keeps dropping it (loss storm), the user is told and
 *              offered a reload instead of a stuck spinner or a false "restored".
 *
 * A single shared banner reflects the state of every managed canvas.
 */

import { allocateCanvasDrawingBuffer } from "./canvasBufferSize";

export type WebGLRecoveryFailureReason = "timeout" | "error" | "loss-storm";

export type WebGLRecoveryState = "active" | "lost" | "failed";

export interface WebGLRenderLoopControl {
  start(): void;
  stop(): void;
}

export interface WebGLContextRecoveryOptions {
  onLost?: () => void;
  /** Rebuild shaders, buffers and textures on the fresh context. Throw to signal failure. */
  onRestore: (gl: WebGLRenderingContext | WebGL2RenderingContext) => void;
  /** Paused on loss, resumed only after onRestore succeeds. */
  renderLoop?: WebGLRenderLoopControl;
  /** Called when recovery is abandoned, e.g. to switch to a non-WebGL fallback. */
  onRestoreFailed?: (reason: WebGLRecoveryFailureReason) => void;
  /** How long to wait for webglcontextrestored before reporting failure. Default 10 s. */
  restoreTimeoutMs?: number;
  /** More than this many losses within lossWindowMs stops recovery. Default 3. */
  maxLosses?: number;
  /** Window for maxLosses. Default 60 s. */
  lossWindowMs?: number;
}

const DEFAULT_RESTORE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_LOSSES = 3;
const DEFAULT_LOSS_WINDOW_MS = 60_000;

const TEXT_RECOVERING = "⚡ Graphics performance issue: Recovering WebGL context...";
const TEXT_RESTORED = "❇️ WebGL graphics context restored successfully!";
const TEXT_FAILED =
  "Graphics couldn't be restored. Reload the page to bring back maps and 3D views.";

type BannerState = "recovering" | "restored" | "failed";

export class WebGLContextRecoveryManager {
  private static activeRecoveries = new Set<WebGLContextRecoveryManager>();
  private static failedRecoveries = new Set<WebGLContextRecoveryManager>();

  /** Invoked by the banner's Reload button; overridable for tests / custom shells. */
  public static reloadPage: () => void = () => window.location.reload();

  private canvas: HTMLCanvasElement;
  private onRestore: WebGLContextRecoveryOptions["onRestore"];
  private onLost?: () => void;
  private renderLoop?: WebGLRenderLoopControl;
  private onRestoreFailed?: (reason: WebGLRecoveryFailureReason) => void;
  private restoreTimeoutMs: number;
  private maxLosses: number;
  private lossWindowMs: number;

  private lossTimestamps: number[] = [];
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private currentState: WebGLRecoveryState = "active";

  constructor(canvas: HTMLCanvasElement, options: WebGLContextRecoveryOptions) {
    this.canvas = canvas;
    this.onRestore = options.onRestore;
    this.onLost = options.onLost;
    this.renderLoop = options.renderLoop;
    this.onRestoreFailed = options.onRestoreFailed;
    this.restoreTimeoutMs = options.restoreTimeoutMs ?? DEFAULT_RESTORE_TIMEOUT_MS;
    this.maxLosses = options.maxLosses ?? DEFAULT_MAX_LOSSES;
    this.lossWindowMs = options.lossWindowMs ?? DEFAULT_LOSS_WINDOW_MS;

    this.canvas.addEventListener("webglcontextlost", this.handleContextLost, false);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored, false);
  }

  /** "active" (rendering), "lost" (awaiting restore) or "failed" (gave up). */
  public get state(): WebGLRecoveryState {
    return this.currentState;
  }

  public static reset() {
    this.activeRecoveries.clear();
    this.failedRecoveries.clear();
    if (typeof document !== "undefined") {
      document.getElementById("webgl-recovery-banner")?.remove();
    }
  }

  public destroy() {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.clearRestoreTimer();

    const M = WebGLContextRecoveryManager;
    const wasActive = M.activeRecoveries.delete(this);
    const wasFailed = M.failedRecoveries.delete(this);
    if (wasActive || wasFailed) M.refreshBanner();
  }

  // ─── Event handlers ──────────────────────────────────────────────────────

  private handleContextLost = (e: Event) => {
    const now = Date.now();
    this.lossTimestamps = this.lossTimestamps.filter((t) => now - t < this.lossWindowMs);
    this.lossTimestamps.push(now);

    if (this.lossTimestamps.length > this.maxLosses) {
      // The GPU keeps dropping this context. Skipping preventDefault() tells
      // the browser not to restore it, which stops the thrash.
      console.warn("[WebGLRecoveryManager] Repeated context loss; giving up recovery.");
      this.stopRenderLoop();
      this.runSafely("onLost", () => this.onLost?.());
      this.fail("loss-storm");
      return;
    }

    // Call preventDefault() synchronously at the top of recovery handling
    // so the browser does not default to permanently destroying the context
    if (typeof e.preventDefault === "function") {
      e.preventDefault();
    }

    this.stopRenderLoop();
    this.runSafely("onLost", () => this.onLost?.());

    console.warn("[WebGLRecoveryManager] WebGL context lost on canvas:", this.canvas);
    this.currentState = "lost";

    const M = WebGLContextRecoveryManager;
    M.failedRecoveries.delete(this);
    M.activeRecoveries.add(this);
    M.refreshBanner();

    this.clearRestoreTimer();
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null;
      if (this.currentState === "lost") this.fail("timeout");
    }, this.restoreTimeoutMs);
  };

  private handleContextRestored = () => {
    // Browsers only restore after a loss; a stray event has nothing to recover.
    if (this.currentState === "active") return;
    this.clearRestoreTimer();

    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    try {
      gl =
        (this.canvas.getContext("webgl2") as WebGL2RenderingContext | null) ||
        (this.canvas.getContext("webgl") as WebGLRenderingContext | null) ||
        (this.canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    } catch (err) {
      console.error("[WebGLRecoveryManager] Failed to retrieve restored context:", err);
    }

    if (!gl) {
      this.fail("error");
      return;
    }

    try {
      // Retina / high-DPI: rebuild the drawing buffer at CSS size × dpr
      // before shaders/buffers are reallocated (#1030).
      const { width, height } = allocateCanvasDrawingBuffer(this.canvas);
      gl.viewport(0, 0, width, height);
      this.onRestore(gl);
    } catch (err) {
      console.error("[WebGLRecoveryManager] Re-initialization after restore failed:", err);
      this.fail("error");
      return;
    }

    console.info("[WebGLRecoveryManager] WebGL context restored and re-initialized.");
    this.currentState = "active";
    this.runSafely("renderLoop.start", () => this.renderLoop?.start());

    const M = WebGLContextRecoveryManager;
    M.activeRecoveries.delete(this);
    M.failedRecoveries.delete(this);
    M.refreshBanner(true);
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private fail(reason: WebGLRecoveryFailureReason) {
    this.clearRestoreTimer();
    this.currentState = "failed";

    const M = WebGLContextRecoveryManager;
    M.activeRecoveries.delete(this);
    M.failedRecoveries.add(this);
    M.refreshBanner();

    this.runSafely("onRestoreFailed", () => this.onRestoreFailed?.(reason));
  }

  private stopRenderLoop() {
    this.runSafely("renderLoop.stop", () => this.renderLoop?.stop());
  }

  private clearRestoreTimer() {
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
  }

  private runSafely(label: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      console.error(`[WebGLRecoveryManager] ${label} threw:`, err);
    }
  }

  // ─── Shared banner ───────────────────────────────────────────────────────

  /** Failed beats recovering beats restored, across all managed canvases. */
  private static refreshBanner(justRestored = false) {
    if (this.failedRecoveries.size > 0) {
      this.renderBanner("failed");
    } else if (this.activeRecoveries.size > 0) {
      this.renderBanner("recovering");
    } else if (justRestored) {
      this.renderBanner("restored");
      setTimeout(() => {
        if (this.activeRecoveries.size === 0 && this.failedRecoveries.size === 0) {
          this.hideBanner();
        }
      }, 2500);
    } else {
      this.hideBanner();
    }
  }

  private static ensureBanner(): HTMLDivElement {
    let banner = document.getElementById("webgl-recovery-banner") as HTMLDivElement | null;
    if (banner) return banner;

    if (!document.getElementById("webgl-recovery-styles")) {
      const style = document.createElement("style");
      style.id = "webgl-recovery-styles";
      style.textContent = `
        @keyframes webgl-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          #webgl-recovery-spinner { animation: none !important; }
          #webgl-recovery-banner { transition: none !important; }
        }
        #webgl-recovery-banner button {
          font: inherit; font-size: 13px; padding: 4px 12px; border-radius: 8px;
          border: 1px solid rgba(244, 244, 245, 0.3); background: transparent;
          color: inherit; cursor: pointer;
        }
        #webgl-recovery-banner button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
      `;
      document.head.appendChild(style);
    }

    banner = document.createElement("div");
    banner.id = "webgl-recovery-banner";
    Object.assign(banner.style, {
      position: "fixed",
      top: "24px",
      left: "50%",
      transform: "translateX(-50%) translateY(-20px)",
      zIndex: "99999",
      maxWidth: "calc(100vw - 32px)",
      padding: "12px 24px",
      borderRadius: "12px",
      background: "rgba(24, 24, 27, 0.9)",
      backdropFilter: "blur(8px)",
      color: "#f4f4f5",
      fontFamily: "Outfit, Inter, system-ui, sans-serif",
      fontSize: "14px",
      fontWeight: "500",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      opacity: "0",
    });

    const spinner = document.createElement("div");
    spinner.id = "webgl-recovery-spinner";
    spinner.setAttribute("aria-hidden", "true");
    Object.assign(spinner.style, {
      width: "16px",
      height: "16px",
      borderRadius: "50%",
      border: "2px solid rgba(239, 68, 68, 0.2)",
      borderTopColor: "#ef4444",
      animation: "webgl-spin 1s linear infinite",
      flexShrink: "0",
    });

    const text = document.createElement("span");
    text.id = "webgl-recovery-text";

    const actions = document.createElement("span");
    actions.id = "webgl-recovery-actions";
    Object.assign(actions.style, { display: "none", gap: "8px" });

    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload";
    reload.addEventListener("click", () => this.reloadPage());

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => {
      this.failedRecoveries.clear();
      this.refreshBanner();
    });

    actions.append(reload, dismiss);
    banner.append(spinner, text, actions);
    document.body.appendChild(banner);
    void banner.offsetWidth; // reflow so the entry transition runs
    return banner;
  }

  private static renderBanner(state: BannerState) {
    if (typeof document === "undefined") return;
    const banner = this.ensureBanner();
    const spinner = document.getElementById("webgl-recovery-spinner") as HTMLDivElement;
    const text = document.getElementById("webgl-recovery-text") as HTMLSpanElement;
    const actions = document.getElementById("webgl-recovery-actions") as HTMLSpanElement;

    const accent = {
      recovering: "239, 68, 68",
      restored: "34, 197, 94",
      failed: "245, 158, 11",
    }[state];

    // Failures interrupt (alert); progress updates are announced politely.
    banner.setAttribute("role", state === "failed" ? "alert" : "status");
    banner.setAttribute("aria-live", state === "failed" ? "assertive" : "polite");
    banner.style.opacity = "1";
    banner.style.transform = "translateX(-50%) translateY(0)";
    banner.style.pointerEvents = state === "failed" ? "auto" : "none";
    banner.style.border = `1px solid rgba(${accent}, 0.3)`;
    banner.style.boxShadow = `0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(${accent}, 0.2)`;

    spinner.style.display = state === "recovering" ? "block" : "none";
    actions.style.display = state === "failed" ? "inline-flex" : "none";
    text.textContent =
      state === "recovering"
        ? TEXT_RECOVERING
        : state === "restored"
          ? TEXT_RESTORED
          : TEXT_FAILED;
  }

  private static hideBanner() {
    if (typeof document === "undefined") return;
    const banner = document.getElementById("webgl-recovery-banner") as HTMLDivElement | null;
    if (!banner) return;

    banner.style.opacity = "0";
    banner.style.transform = "translateX(-50%) translateY(-20px)";
    banner.style.pointerEvents = "none";

    setTimeout(() => {
      if (
        WebGLContextRecoveryManager.activeRecoveries.size === 0 &&
        WebGLContextRecoveryManager.failedRecoveries.size === 0
      ) {
        banner.remove();
      }
    }, 400);
  }
}

/**
 * Convenience function to attach recovery listener that behaves similarly to attachWebGLContextRecovery.
 */
export function attachWebGLRecoveryManager(
  canvas: HTMLCanvasElement,
  onRestore: (gl: WebGLRenderingContext | WebGL2RenderingContext) => void,
  onLost?: () => void,
  options: Omit<WebGLContextRecoveryOptions, "onRestore" | "onLost"> = {},
): () => void {
  const manager = new WebGLContextRecoveryManager(canvas, {
    ...options,
    onRestore,
    onLost,
  });
  return () => manager.destroy();
}
