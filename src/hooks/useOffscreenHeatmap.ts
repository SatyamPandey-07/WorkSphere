"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseOffscreenHeatmapOptions {
  gridW: number;
  gridH: number;
}

/**
 * Renders a crowd density heatmap on a canvas element using an OffscreenCanvas
 * Web Worker so the main UI thread stays responsive during map panning.
 *
 * @param canvasRef - ref to the <canvas> element to render onto
 * @param options - grid dimensions for the density array
 * @returns `renderDensity(density)` — call this with a new Float32Array to update
 */
export function useOffscreenHeatmap(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: UseOffscreenHeatmapOptions,
) {
  const { gridW, gridH } = options;
  const workerRef = useRef<Worker | null>(null);
  const transferredRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof OffscreenCanvas === "undefined") return;

    if (transferredRef.current) return;

    const worker = new Worker(
      new URL("../workers/heatmapRenderer.worker.ts", import.meta.url),
    );

    // Transfer canvas ownership to the worker
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: "INIT", canvas: offscreen }, [offscreen]);

    workerRef.current = worker;
    transferredRef.current = true;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [canvasRef]);

  const renderDensity = useCallback(
    (density: Float32Array) => {
      const canvas = canvasRef.current;
      const worker = workerRef.current;
      if (!worker || !canvas) return;

      // Transfer the density buffer to avoid copying
      const transfer = density.buffer.slice(0);
      worker.postMessage(
        {
          type: "RENDER",
          density: new Float32Array(transfer),
          gridW,
          gridH,
          canvasW: canvas.width,
          canvasH: canvas.height,
        },
        [transfer],
      );
    },
    [canvasRef, gridW, gridH],
  );

  return { renderDensity };
}
