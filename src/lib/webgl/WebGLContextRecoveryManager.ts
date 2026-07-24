/**
 * WebGLContextRecoveryManager.ts
 *
 * A utility class and helper to coordinate WebGL context lost and restored events
 * across the application, preventing blackouts, re-initializing WebGL resources,
 * and displaying a premium, non-intrusive recovery progress banner to the user.
 */

export interface WebGLContextRecoveryOptions {
  onLost?: () => void;
  onRestore: (gl: WebGLRenderingContext | WebGL2RenderingContext) => void;
}

export class WebGLContextRecoveryManager {
  private canvas: HTMLCanvasElement;
  private onRestore: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
  ) => void;
  private onLost?: () => void;
  private static activeRecoveries = new Set<HTMLCanvasElement>();
  private static bannerElement: HTMLDivElement | null = null;
  private isLost = false;

  constructor(canvas: HTMLCanvasElement, options: WebGLContextRecoveryOptions) {
    this.canvas = canvas;
    this.onRestore = options.onRestore;
    this.onLost = options.onLost;
    this.init();
  }

  private init() {
    this.canvas.addEventListener(
      "webglcontextlost",
      this.handleContextLost,
      false,
    );
    this.canvas.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
      false,
    );
  }

  public static reset() {
    this.activeRecoveries.clear();
    if (typeof document !== "undefined") {
      const banner = document.getElementById("webgl-recovery-banner");
      if (banner && banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
    }
  }

  public destroy() {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );

    if (this.isLost) {
      WebGLContextRecoveryManager.activeRecoveries.delete(this.canvas);
      if (WebGLContextRecoveryManager.activeRecoveries.size === 0) {
        WebGLContextRecoveryManager.hideBanner();
      }
    }
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.isLost = true;
    console.warn(
      "[WebGLRecoveryManager] WebGL context lost on canvas:",
      this.canvas,
    );

    if (this.onLost) {
      this.onLost();
    }

    WebGLContextRecoveryManager.activeRecoveries.add(this.canvas);
    WebGLContextRecoveryManager.showBanner();
  };

  private handleContextRestored = (_e: Event) => {
    this.isLost = false;
    console.log(
      "[WebGLRecoveryManager] WebGL context restored on canvas. Re-initializing shaders, buffers, and textures:",
      this.canvas,
    );

    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    try {
      gl =
        (this.canvas.getContext("webgl2") as any) ||
        (this.canvas.getContext("webgl") as any) ||
        (this.canvas.getContext("experimental-webgl") as any);
    } catch (err) {
      console.error(
        "[WebGLRecoveryManager] Failed to retrieve context for re-initialization:",
        err,
      );
    }

    if (gl) {
      try {
        this.onRestore(gl);
      } catch (err) {
        console.error(
          "[WebGLRecoveryManager] Error during onRestore callback execution:",
          err,
        );
      }
    }

    WebGLContextRecoveryManager.activeRecoveries.delete(this.canvas);
    if (WebGLContextRecoveryManager.activeRecoveries.size === 0) {
      WebGLContextRecoveryManager.showSuccess();
    }
  };

  private static showBanner() {
    if (typeof document === "undefined") return;
    let banner = document.getElementById(
      "webgl-recovery-banner",
    ) as HTMLDivElement | null;

    if (!banner) {
      banner = document.createElement("div");
      banner.id = "webgl-recovery-banner";

      // Gorgeous premium styling matching the workspace theme
      Object.assign(banner.style, {
        position: "fixed",
        top: "24px",
        left: "50%",
        transform: "translateX(-50%) translateY(-20px)",
        zIndex: "99999",
        padding: "12px 24px",
        borderRadius: "12px",
        background: "rgba(24, 24, 27, 0.85)",
        backdropFilter: "blur(8px)",
        webkitBackdropFilter: "blur(8px)",
        border: "1px solid rgba(239, 68, 68, 0.2)",
        boxShadow:
          "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(239, 68, 68, 0.15)",
        color: "#f4f4f5",
        fontFamily: "Outfit, Inter, system-ui, sans-serif",
        fontSize: "14px",
        fontWeight: "500",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        opacity: "0",
        pointerEvents: "none",
      });

      const spinner = document.createElement("div");
      spinner.id = "webgl-recovery-spinner";
      Object.assign(spinner.style, {
        width: "16px",
        height: "16px",
        borderRadius: "50%",
        border: "2px solid rgba(239, 68, 68, 0.2)",
        borderTopColor: "#ef4444",
        animation: "webgl-spin 1s linear infinite",
        flexShrink: "0",
      });

      // Inject custom spinner styles
      if (!document.getElementById("webgl-recovery-styles")) {
        const styleSheet = document.createElement("style");
        styleSheet.id = "webgl-recovery-styles";
        styleSheet.innerText = `
          @keyframes webgl-spin {
            to { transform: rotate(360deg); }
          }
        `;
        document.head.appendChild(styleSheet);
      }

      const text = document.createElement("span");
      text.id = "webgl-recovery-text";
      text.textContent =
        "⚡ Graphics performance issue: Recovering WebGL context...";

      banner.appendChild(spinner);
      banner.appendChild(text);
      document.body.appendChild(banner);

      // Trigger layout reflow for CSS transitions
      void banner.offsetWidth;
    }

    // Set/reset banner to recovering state
    banner.style.opacity = "1";
    banner.style.transform = "translateX(-50%) translateY(0)";
    banner.style.border = "1px solid rgba(239, 68, 68, 0.3)";
    banner.style.boxShadow =
      "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(239, 68, 68, 0.2)";

    const spinner = document.getElementById(
      "webgl-recovery-spinner",
    ) as HTMLDivElement | null;
    if (spinner) {
      spinner.style.border = "2px solid rgba(239, 68, 68, 0.2)";
      spinner.style.borderTopColor = "#ef4444";
      spinner.style.display = "block";
    }

    const text = document.getElementById("webgl-recovery-text");
    if (text) {
      text.textContent =
        "⚡ Graphics performance issue: Recovering WebGL context...";
    }
  }

  private static showSuccess() {
    if (typeof document === "undefined") return;
    const banner = document.getElementById(
      "webgl-recovery-banner",
    ) as HTMLDivElement | null;
    if (!banner) return;

    // Transition style to success (green glow)
    banner.style.border = "1px solid rgba(34, 197, 94, 0.3)";
    banner.style.boxShadow =
      "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(34, 197, 94, 0.2)";

    const spinner = document.getElementById(
      "webgl-recovery-spinner",
    ) as HTMLDivElement | null;
    if (spinner) {
      spinner.style.display = "none";
    }

    const text = document.getElementById("webgl-recovery-text");
    if (text) {
      text.textContent = "❇️ WebGL graphics context restored successfully!";
    }

    // Hide banner after 2.5 seconds if no new recoveries started
    setTimeout(() => {
      if (WebGLContextRecoveryManager.activeRecoveries.size === 0) {
        WebGLContextRecoveryManager.hideBanner();
      }
    }, 2500);
  }

  private static hideBanner() {
    if (typeof document === "undefined") return;
    const banner = document.getElementById(
      "webgl-recovery-banner",
    ) as HTMLDivElement | null;
    if (!banner) return;

    banner.style.opacity = "0";
    banner.style.transform = "translateX(-50%) translateY(-20px)";

    setTimeout(() => {
      if (
        WebGLContextRecoveryManager.activeRecoveries.size === 0 &&
        banner.parentNode
      ) {
        banner.parentNode.removeChild(banner);
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
): () => void {
  const manager = new WebGLContextRecoveryManager(canvas, {
    onRestore,
    onLost,
  });
  return () => manager.destroy();
}
