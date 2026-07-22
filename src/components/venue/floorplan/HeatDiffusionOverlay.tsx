"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Thermometer } from "lucide-react";
import { HeatDiffusionEngine } from "@/lib/webgpu/heatDiffusion";
import { HeatDiffusionFallback } from "@/lib/webgpu/heatDiffusionFallback";
import type { HvacSensor } from "@/lib/webgpu/heatEquation";

export type HeatDiffusionOverlayProps = {
  width?: number;
  height?: number;
  gridWidth?: number;
  gridHeight?: number;
  /** HVAC / temperature sensor telemetry mapped onto the seating grid */
  sensors?: HvacSensor[];
};

/**
 * Real-time thermal diffusion heatmap overlaid on a venue seating grid.
 * Prefers WebGPU WGSL compute; falls back to WebGL 2.0 + CPU Jacobi.
 */
export function HeatDiffusionOverlay({
  width = 720,
  height = 420,
  gridWidth = 64,
  gridHeight = 64,
  sensors,
}: HeatDiffusionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<HeatDiffusionEngine | null>(null);
  const fallbackRef = useRef<HeatDiffusionFallback | null>(null);
  const [mode, setMode] = useState<"detecting" | "WebGPU" | "WebGL 2.0">(
    "detecting",
  );
  const [paused, setPaused] = useState(false);

  const tearDown = useCallback(() => {
    engineRef.current?.destroy();
    fallbackRef.current?.destroy();
    engineRef.current = null;
    fallbackRef.current = null;
  }, []);

  const startFallback = useCallback(
    (canvas: HTMLCanvasElement) => {
      const fallback = new HeatDiffusionFallback(canvas, {
        width: gridWidth,
        height: gridHeight,
        sensors,
      });
      if (!fallback.initialize()) {
        setMode("WebGL 2.0");
        return;
      }
      fallbackRef.current = fallback;
      setMode("WebGL 2.0");
      fallback.start();
    },
    [gridHeight, gridWidth, sensors],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = width;
    canvas.height = height;
    let cancelled = false;

    (async () => {
      if (navigator.gpu) {
        const engine = new HeatDiffusionEngine(canvas, {
          width: gridWidth,
          height: gridHeight,
          sensors,
        });
        const ok = await engine.initialize();
        if (cancelled) {
          engine.destroy();
          return;
        }
        if (ok) {
          engineRef.current = engine;
          setMode("WebGPU");
          engine.start();
          return;
        }
        engine.destroy();
      }
      if (!cancelled) startFallback(canvas);
    })();

    return () => {
      cancelled = true;
      tearDown();
    };
  }, [gridHeight, gridWidth, height, sensors, startFallback, tearDown, width]);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      if (next) {
        engineRef.current?.stop();
        fallbackRef.current?.stop();
      } else {
        engineRef.current?.start();
        fallbackRef.current?.start();
      }
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    tearDown();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setPaused(false);
    setMode("detecting");
    (async () => {
      if (navigator.gpu) {
        const engine = new HeatDiffusionEngine(canvas, {
          width: gridWidth,
          height: gridHeight,
          sensors,
        });
        if (await engine.initialize()) {
          engineRef.current = engine;
          setMode("WebGPU");
          engine.start();
          return;
        }
        engine.destroy();
      }
      startFallback(canvas);
    })();
  }, [gridHeight, gridWidth, sensors, startFallback, tearDown]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-md dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-start gap-2">
          <Thermometer className="mt-0.5 h-4 w-4 text-orange-500" />
          <div>
            <p className="text-sm font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
              Thermal Diffusion
            </p>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {mode === "detecting"
                ? "Detecting GPU…"
                : `${mode} heat equation`}{" "}
              • HVAC seating map overlay
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={togglePause}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label={paused ? "Resume simulation" : "Pause simulation"}
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
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Reset simulation"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="relative bg-zinc-950">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="block h-auto w-full"
          aria-label="Venue temperature heatmap overlay"
        />
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-black/50 px-2 py-1 text-[10px] text-zinc-200">
          <span className="h-2 w-8 rounded-sm bg-gradient-to-r from-blue-600 via-yellow-400 to-red-500" />
          cool → warm
        </div>
      </div>
    </div>
  );
}
