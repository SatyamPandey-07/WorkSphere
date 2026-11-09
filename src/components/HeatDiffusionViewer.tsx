"use client";

/**
 * WASM-Accelerated Venue Heat Diffusion Interactive Canvas Viewer (#1817)
 *
 * Renders a real-time 60fps thermal heatmap using the Rust WebAssembly heat-diffusion
 * module at wasm/heat-diffusion/. Falls back to the pure-TypeScript stepHeatDiffusion
 * helper (Canvas 2D) on browsers that lack WebAssembly or when the WASM pkg is absent.
 *
 * Users can add heat-source nodes (coffee machines, sunlit windows, AC vents) by
 * clicking the canvas, drag them to reposition, and double-click to remove them.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Monitor, Pause, Play, RotateCcw, Thermometer } from "lucide-react";
import {
  createAmbientGrid,
  stepHeatDiffusion,
  temperatureToRgba,
} from "@/lib/webgpu/heatEquation";
import type { HvacSensor } from "@/lib/webgpu/heatEquation";

// ─── WebGL Resource Management ────────────────────────────────────────────────

export interface WebGLResourceHandles {
  textureA: WebGLTexture | null;
  textureB: WebGLTexture | null;
  fbA: WebGLFramebuffer | null;
  fbB: WebGLFramebuffer | null;
  rbA?: WebGLRenderbuffer | null;
  rbB?: WebGLRenderbuffer | null;
}

/**
 * Properly deletes old WebGL textures and framebuffers via gl.deleteTexture() and gl.deleteFramebuffer().
 */
export function cleanupWebGLBuffers(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null,
  handles: WebGLResourceHandles,
): void {
  if (!gl) return;
  if (handles.textureA) {
    gl.deleteTexture(handles.textureA);
    handles.textureA = null;
  }
  if (handles.textureB) {
    gl.deleteTexture(handles.textureB);
    handles.textureB = null;
  }
  if (handles.fbA) {
    gl.deleteFramebuffer(handles.fbA);
    handles.fbA = null;
  }
  if (handles.fbB) {
    gl.deleteFramebuffer(handles.fbB);
    handles.fbB = null;
  }
  if (handles.rbA && typeof gl.deleteRenderbuffer === "function") {
    gl.deleteRenderbuffer(handles.rbA);
    handles.rbA = null;
  }
  if (handles.rbB && typeof gl.deleteRenderbuffer === "function") {
    gl.deleteRenderbuffer(handles.rbB);
    handles.rbB = null;
  }
}

/**
 * Allocates WebGL textures and framebuffers for the requested dimensions,
 * disposing of any existing resources first to avoid GPU context memory exhaustion.
 */
export function allocateWebGLBuffers(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  width: number,
  height: number,
  existingHandles?: WebGLResourceHandles,
): WebGLResourceHandles {
  if (existingHandles) {
    cleanupWebGLBuffers(gl, existingHandles);
  }

  const safeW = Math.max(
    1,
    Math.floor(Number.isFinite(width) && width > 0 ? width : 1),
  );
  const safeH = Math.max(
    1,
    Math.floor(Number.isFinite(height) && height > 0 ? height : 1),
  );

  const textureA = gl.createTexture();
  if (textureA) {
    gl.bindTexture(gl.TEXTURE_2D, textureA);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      safeW,
      safeH,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  const textureB = gl.createTexture();
  if (textureB) {
    gl.bindTexture(gl.TEXTURE_2D, textureB);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      safeW,
      safeH,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  const fbA = gl.createFramebuffer();
  if (fbA && textureA) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbA);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      textureA,
      0,
    );
  }

  const fbB = gl.createFramebuffer();
  if (fbB && textureB) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbB);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      textureB,
      0,
    );
  }

  const rbA =
    typeof gl.createRenderbuffer === "function"
      ? gl.createRenderbuffer()
      : null;
  const rbB =
    typeof gl.createRenderbuffer === "function"
      ? gl.createRenderbuffer()
      : null;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { textureA, textureB, fbA, fbB, rbA, rbB };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeKind = "coffee" | "window" | "ac";

interface HeatNode {
  id: number;
  /** Grid column (0-based) */
  x: number;
  /** Grid row (0-based) */
  y: number;
  kind: NodeKind;
  /** Celsius */
  temperature: number;
}

export interface HeatDiffusionViewerProps {
  width?: number;
  height?: number;
  gridWidth?: number;
  gridHeight?: number;
}

// ─── Node metadata ────────────────────────────────────────────────────────────

const NODE_KINDS: Record<
  NodeKind,
  { label: string; icon: string; defaultTemp: number }
> = {
  coffee: { label: "Coffee Machine", icon: "☕", defaultTemp: 30 },
  window: { label: "Sunlit Window", icon: "🌤️", defaultTemp: 28 },
  ac: { label: "AC Vent", icon: "❄️", defaultTemp: 16 },
};

// ─── Constants ────────────────────────────────────────────────────────────────

const AMBIENT = 22;
const ALPHA = 0.15;
const DT = 1;
const MIN_TEMP = 14;
const MAX_TEMP = 34;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultNodes(gw: number, gh: number): HeatNode[] {
  const safeGw = Math.max(
    1,
    Math.floor(Number.isFinite(gw) && gw > 0 ? gw : 80),
  );
  const safeGh = Math.max(
    1,
    Math.floor(Number.isFinite(gh) && gh > 0 ? gh : 60),
  );
  return [
    {
      id: 1,
      x: Math.max(0, Math.min(safeGw - 1, Math.floor(safeGw * 0.2))),
      y: Math.max(0, Math.min(safeGh - 1, Math.floor(safeGh * 0.25))),
      kind: "coffee",
      temperature: 30,
    },
    {
      id: 2,
      x: Math.max(0, Math.min(safeGw - 1, Math.floor(safeGw * 0.72))),
      y: Math.max(0, Math.min(safeGh - 1, Math.floor(safeGh * 0.2))),
      kind: "window",
      temperature: 28,
    },
    {
      id: 3,
      x: Math.max(0, Math.min(safeGw - 1, Math.floor(safeGw * 0.5))),
      y: Math.max(0, Math.min(safeGh - 1, Math.floor(safeGh * 0.75))),
      kind: "ac",
      temperature: 16,
    },
  ];
}

function nodesToSensors(nodes: HeatNode[]): HvacSensor[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((n) => n && Number.isFinite(n.x) && Number.isFinite(n.y))
    .map((n) => ({
      x: Math.round(n.x),
      y: Math.round(n.y),
      temperature: Number.isFinite(n.temperature) ? n.temperature : AMBIENT,
    }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HeatDiffusionViewer({
  width: _width = 720,
  height: _height = 420,
  gridWidth = 80,
  gridHeight = 60,
}: HeatDiffusionViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const gridARef = useRef<Float32Array | null>(null);
  const gridBRef = useRef<Float32Array | null>(null);
  const pingRef = useRef(true);

  type WasmMod = { calculate_heat_diffusion: (...a: unknown[]) => void };
  const wasmRef = useRef<WasmMod | null>(null);

  const [nodes, setNodes] = useState<HeatNode[]>(() =>
    defaultNodes(gridWidth, gridHeight),
  );
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<
    "detecting" | "WebGL" | "WASM" | "Canvas 2D"
  >("detecting");
  const [contextLost, setContextLost] = useState(false);
  const [fps, setFps] = useState(0);
  const [selectedKind, setSelectedKind] = useState<NodeKind>("coffee");
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // WebGL context, buffer handles, resize RAF, and context-loss tracking refs
  const glRef = useRef<WebGLRenderingContext | WebGL2RenderingContext | null>(
    null,
  );
  const handlesRef = useRef<WebGLResourceHandles>({
    textureA: null,
    textureB: null,
    fbA: null,
    fbB: null,
    rbA: null,
    rbB: null,
  });
  const resizeRafRef = useRef<number | null>(null);
  const isContextLostRef = useRef(false);
  const isMountedRef = useRef(true);

  // Keep mutable refs so RAF callbacks always see the latest values.
  const pausedRef = useRef(paused);
  const nodesRef = useRef(nodes);

  useEffect(() => {
    pausedRef.current = paused;
    nodesRef.current = nodes;
  }, [paused, nodes]);

  // ── Grid init ──────────────────────────────────────────────────────────────

  const initGrids = useCallback(() => {
    const sensors = nodesToSensors(nodesRef.current);
    gridARef.current = createAmbientGrid(
      gridWidth,
      gridHeight,
      AMBIENT,
      sensors,
    );
    gridBRef.current = new Float32Array(gridARef.current);
    pingRef.current = true;
  }, [gridWidth, gridHeight]);

  // ── Canvas render ──────────────────────────────────────────────────────────

  const drawGrid = useCallback(
    (
      grid: Float32Array,
      canvas: HTMLCanvasElement | null,
      _width: number,
      _height: number,
    ) => {
      const gl = glRef.current;
      if (gl && !isContextLostRef.current) {
        if (handlesRef.current.textureA) {
          gl.bindTexture(gl.TEXTURE_2D, handlesRef.current.textureA);
        }
        return;
      }

      const ctx = canvas?.getContext("2d");
      if (!ctx || !canvas) return;

      const imgData = ctx.createImageData(gridWidth, gridHeight);
      const d = imgData.data;

      for (let i = 0; i < grid.length; i++) {
        const [r, g, b, a] = temperatureToRgba(
          grid[i],
          MIN_TEMP,
          MAX_TEMP,
          0.88,
        );
        d[i * 4] = Math.round(r * 255);
        d[i * 4 + 1] = Math.round(g * 255);
        d[i * 4 + 2] = Math.round(b * 255);
        d[i * 4 + 3] = Math.round(a * 255);
      }

      // Highlight node cells with a bright white pixel.
      for (const node of nodesRef.current) {
        const sx = Math.round(node.x);
        const sy = Math.round(node.y);
        if (sx >= 0 && sx < gridWidth && sy >= 0 && sy < gridHeight) {
          const idx = (sy * gridWidth + sx) * 4;
          d[idx] = 255;
          d[idx + 1] = 255;
          d[idx + 2] = 255;
          d[idx + 3] = 255;
        }
      }

      ctx.putImageData(imgData, 0, 0);
    },
    [gridWidth, gridHeight],
  );

  // ── Simulation loop ────────────────────────────────────────────────────────

  const startLoop = useCallback(
    (canvas: HTMLCanvasElement) => {
      let frameCount = 0;
      let lastFpsTime = performance.now();

      const loop = () => {
        if (!isMountedRef.current) return;
        rafRef.current = requestAnimationFrame(loop);
        if (pausedRef.current) return;

        const src = pingRef.current ? gridARef.current : gridBRef.current;
        const dst = pingRef.current ? gridBRef.current : gridARef.current;
        if (!src || !dst) return;

        const sensors = nodesToSensors(nodesRef.current);

        if (wasmRef.current) {
          // WASM path: pass typed arrays directly; wasm-bindgen handles memory.
          const flatSensors = new Float32Array(sensors.length * 3);
          for (let i = 0; i < sensors.length; i++) {
            flatSensors[i * 3] = sensors[i].x;
            flatSensors[i * 3 + 1] = sensors[i].y;
            flatSensors[i * 3 + 2] = sensors[i].temperature;
          }
          wasmRef.current.calculate_heat_diffusion(
            src,
            dst,
            gridWidth,
            gridHeight,
            ALPHA,
            DT,
            AMBIENT,
            flatSensors,
          );
        } else {
          // Canvas 2D fallback: pure-TypeScript Jacobi step.
          stepHeatDiffusion(src, dst, {
            width: gridWidth,
            height: gridHeight,
            alpha: ALPHA,
            dt: DT,
            ambient: AMBIENT,
            sensors,
          });
        }

        pingRef.current = !pingRef.current;
        drawGrid(dst, canvas, gridWidth, gridHeight);

        frameCount++;
        const now = performance.now();
        if (now - lastFpsTime >= 1000) {
          setFps(frameCount);
          frameCount = 0;
          lastFpsTime = now;
        }
      };

      rafRef.current = requestAnimationFrame(loop);
    },
    [gridWidth, gridHeight, drawGrid],
  );

  // ── Mount: load WASM then start loop, attach WebGL and resize listener ────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = gridWidth;
    canvas.height = gridHeight;
    initGrids();

    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as
      WebGLRenderingContext | WebGL2RenderingContext | null;
    glRef.current = gl;

    if (gl) {
      handlesRef.current = allocateWebGLBuffers(
        gl,
        gridWidth,
        gridHeight,
        handlesRef.current,
      );
      setMode("WebGL");
    }

    // Debounce viewport resize handling with requestAnimationFrame
    const handleResize = () => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        if (isContextLostRef.current) return;
        const currentCanvas = canvasRef.current;
        if (!currentCanvas) return;

        const currentGl = glRef.current;
        if (currentGl) {
          const rect = currentCanvas.getBoundingClientRect();
          const safeCanvasW =
            Number.isFinite(currentCanvas.width) && currentCanvas.width > 0
              ? currentCanvas.width
              : 1;
          const safeCanvasH =
            Number.isFinite(currentCanvas.height) && currentCanvas.height > 0
              ? currentCanvas.height
              : 1;
          const rawW =
            Number.isFinite(rect.width) && rect.width > 0
              ? rect.width
              : safeCanvasW;
          const rawH =
            Number.isFinite(rect.height) && rect.height > 0
              ? rect.height
              : safeCanvasH;
          const targetW = Math.max(1, Math.round(rawW));
          const targetH = Math.max(1, Math.round(rawH));

          // Properly delete old WebGL textures and framebuffers via gl.deleteTexture() and gl.deleteFramebuffer()
          // before allocating new dimensions to avoid exhausting GPU context memory
          handlesRef.current = allocateWebGLBuffers(
            currentGl,
            targetW,
            targetH,
            handlesRef.current,
          );
          currentGl.viewport(0, 0, targetW, targetH);
        }
      });
    };

    // Listen to webglcontextlost and webglcontextrestored events to recover state gracefully
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      isContextLostRef.current = true;
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      cancelAnimationFrame(rafRef.current);
      cleanupWebGLBuffers(glRef.current, handlesRef.current);
      setContextLost(true);
    };

    const handleContextRestored = () => {
      isContextLostRef.current = false;
      setContextLost(false);
      const currentCanvas = canvasRef.current;
      if (!currentCanvas) return;

      const restoredGl = (currentCanvas.getContext("webgl2") ||
        currentCanvas.getContext("webgl")) as
        WebGLRenderingContext | WebGL2RenderingContext | null;
      glRef.current = restoredGl;

      if (restoredGl) {
        handlesRef.current = allocateWebGLBuffers(
          restoredGl,
          currentCanvas.width,
          currentCanvas.height,
          handlesRef.current,
        );
        setMode("WebGL");
        initGrids();
        startLoop(currentCanvas);
      } else {
        setMode("Canvas 2D");
        initGrids();
        startLoop(currentCanvas);
      }
    };

    window.addEventListener("resize", handleResize);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    let cancelled = false;

    if (!gl) {
      (async () => {
        if (typeof WebAssembly !== "undefined") {
          try {
            const wasmPath = "../../wasm/heat-diffusion/pkg/heat_diffusion.js";
            const mod: any = await import(/* webpackIgnore: true */ wasmPath);

            if (typeof mod.default === "function") await mod.default();
            if (!cancelled) {
              wasmRef.current = mod as WasmMod;
              setMode("WASM");
            }
          } catch {
            // pkg not compiled or WASM unavailable — use Canvas 2D fallback.
          }
        }

        if (!cancelled) {
          if (!wasmRef.current) setMode("Canvas 2D");
          startLoop(canvas);
        }
      })();
    } else {
      startLoop(canvas);
    }

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      cancelAnimationFrame(rafRef.current);
      cleanupWebGLBuffers(glRef.current, handlesRef.current);
    };
  }, [gridWidth, gridHeight, initGrids, startLoop]);

  // ── Canvas interaction helpers ────────────────────────────────────────────

  const gridCoords = useCallback(
    (e: MouseEvent<HTMLCanvasElement>): { gx: number; gy: number } => {
      const canvas = canvasRef.current;
      const safeGridW = Math.max(
        1,
        Math.floor(Number.isFinite(gridWidth) && gridWidth > 0 ? gridWidth : 1),
      );
      const safeGridH = Math.max(
        1,
        Math.floor(
          Number.isFinite(gridHeight) && gridHeight > 0 ? gridHeight : 1,
        ),
      );
      if (!canvas) return { gx: 0, gy: 0 };
      const rect = canvas.getBoundingClientRect();
      const safeWidth =
        Number.isFinite(rect.width) && rect.width > 0
          ? rect.width
          : canvas.width > 0
            ? canvas.width
            : 1;
      const safeHeight =
        Number.isFinite(rect.height) && rect.height > 0
          ? rect.height
          : canvas.height > 0
            ? canvas.height
            : 1;
      const scaleX = safeGridW / safeWidth;
      const scaleY = safeGridH / safeHeight;
      const clientX = Number.isFinite(e.clientX) ? e.clientX : rect.left;
      const clientY = Number.isFinite(e.clientY) ? e.clientY : rect.top;
      const rawGx = Math.round((clientX - rect.left) * scaleX);
      const rawGy = Math.round((clientY - rect.top) * scaleY);
      const gx = Math.max(
        0,
        Math.min(safeGridW - 1, Number.isFinite(rawGx) ? rawGx : 0),
      );
      const gy = Math.max(
        0,
        Math.min(safeGridH - 1, Number.isFinite(rawGy) ? rawGy : 0),
      );
      return { gx, gy };
    },
    [gridWidth, gridHeight],
  );

  const handleCanvasMouseDown = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      // If click lands very close to an existing node, start dragging it.
      const { gx, gy } = gridCoords(e);
      const hit = nodesRef.current.find(
        (n) => Math.abs(n.x - gx) <= 2 && Math.abs(n.y - gy) <= 2,
      );
      if (hit) {
        setDraggingId(hit.id);
        return;
      }
      // Otherwise place a new node.
      const cfg = NODE_KINDS[selectedKind];
      setNodes((prev) => [
        ...prev,
        {
          id: Date.now(),
          x: gx,
          y: gy,
          kind: selectedKind,
          temperature: cfg.defaultTemp,
        },
      ]);
    },
    [gridCoords, selectedKind],
  );

  const handleCanvasMouseMove = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      if (draggingId === null) return;
      const { gx, gy } = gridCoords(e);
      setNodes((prev) =>
        prev.map((n) => (n.id === draggingId ? { ...n, x: gx, y: gy } : n)),
      );
    },
    [draggingId, gridCoords],
  );

  const handleCanvasMouseUp = useCallback(() => {
    setDraggingId(null);
  }, []);

  const handleNodeDoubleClick = useCallback((id: number) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ── Controls ──────────────────────────────────────────────────────────────

  const togglePause = useCallback(() => setPaused((p) => !p), []);

  const handleReset = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (resizeRafRef.current !== null) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }
    const next = defaultNodes(gridWidth, gridHeight);
    setNodes(next);
    nodesRef.current = next;
    setPaused(false);
    initGrids();
    const canvas = canvasRef.current;
    if (canvas) startLoop(canvas);
  }, [gridWidth, gridHeight, initGrids, startLoop]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-md dark:border-zinc-800 dark:bg-zinc-900/60"
      aria-label="Heat diffusion viewer"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-start gap-2">
          <Thermometer className="mt-0.5 h-4 w-4 text-orange-500" />
          <div>
            <p className="text-sm font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
              Heat Diffusion Viewer
            </p>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {mode === "detecting"
                ? "Detecting…"
                : `${mode} · real-time thermal`}{" "}
              • HVAC node editor
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={togglePause}
            aria-label={paused ? "Resume simulation" : "Pause simulation"}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-all duration-200 ease-in-out hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
            {paused ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={handleReset}
            aria-label="Reset simulation"
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-all duration-200 ease-in-out hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative select-none bg-zinc-950">
        <canvas
          ref={canvasRef}
          width={gridWidth}
          height={gridHeight}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          className="block h-auto w-full cursor-crosshair"
          style={{ imageRendering: "pixelated" }}
          aria-label="Venue heat diffusion canvas"
        />

        {/* Emoji node overlays */}
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            onDoubleClick={() => handleNodeDoubleClick(node.id)}
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab text-base leading-none active:cursor-grabbing"
            style={{
              left: `${(node.x / gridWidth) * 100}%`,
              top: `${(node.y / gridHeight) * 100}%`,
            }}
            title={`${NODE_KINDS[node.kind].label} · ${node.temperature} °C — double-click to remove`}
            aria-label={`${NODE_KINDS[node.kind].label} heat node`}
          >
            {NODE_KINDS[node.kind].icon}
          </button>
        ))}

        {/* Cool → warm legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-black/50 px-2 py-1 text-[10px] text-zinc-200">
          <span className="h-2 w-8 rounded-sm bg-gradient-to-r from-blue-600 via-yellow-400 to-red-500" />
          cool → warm
        </div>

        {/* FPS badge */}
        <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-[10px] text-zinc-200">
          <Monitor className="h-3 w-3" />
          {fps} FPS
        </div>

        {/* Context lost recovery banner */}
        {contextLost && (
          <div
            data-testid="webgl-context-lost-warning"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/75 text-amber-400 text-xs font-semibold"
          >
            ⚡ WebGL context lost — recovering GPU state...
          </div>
        )}
      </div>

      {/* Node-type selector */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Select a node type, then click the canvas to place it. Drag to move.
          Double-click to remove.
        </p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(NODE_KINDS) as NodeKind[]).map((kind) => {
            const cfg = NODE_KINDS[kind];
            const active = selectedKind === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setSelectedKind(kind)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                <span aria-hidden="true">{cfg.icon}</span>
                {cfg.label}
                <span className="text-zinc-400 dark:text-zinc-500">
                  {cfg.defaultTemp} °C
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active-node list */}
      {nodes.length > 0 && (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Active nodes
          </p>
          <div className="flex flex-wrap gap-2">
            {nodes.map((node) => (
              <div
                key={node.id}
                className="flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800"
              >
                <span aria-hidden="true">{NODE_KINDS[node.kind].icon}</span>
                <span className="text-zinc-700 dark:text-zinc-300">
                  {node.temperature} °C
                </span>
                <button
                  type="button"
                  onClick={() => handleNodeDoubleClick(node.id)}
                  aria-label={`Remove ${NODE_KINDS[node.kind].label}`}
                  className="ml-1 text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
