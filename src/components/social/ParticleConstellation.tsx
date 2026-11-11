"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ParticleConstellationRenderer,
  type ParticleConstellationNodeInput,
} from "@/lib/webgl/ParticleConstellationRenderer";

export interface ParticleConstellationProps {
  /** Number of rendered nodes. Defaults to 10,000. */
  nodeCount?: number;
  /** Optional explicit nodes; omitted nodes are generated deterministically. */
  nodes?: ParticleConstellationNodeInput[];
  seed?: number;
  connectionDistance?: number;
  maxConnectionsPerNode?: number;
  lineRefreshIntervalMs?: number;
  className?: string;
  showHud?: boolean;
  onFpsSample?: (fps: number) => void;
}

interface Point {
  x: number;
  y: number;
}

interface PinchState {
  distance: number;
  centerX: number;
  centerY: number;
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export function ParticleConstellation({
  nodeCount = 10_000,
  nodes,
  seed = 1,
  connectionDistance = 72,
  maxConnectionsPerNode = 3,
  lineRefreshIntervalMs = 120,
  className,
  showHud = true,
  onFpsSample,
}: ParticleConstellationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ParticleConstellationRenderer | null>(null);
  const [fps, setFps] = useState(0);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rect = container.getBoundingClientRect();
    const renderer = new ParticleConstellationRenderer(canvas, {
      nodeCount,
      nodes,
      seed,
      connectionDistance,
      maxConnectionsPerNode,
      lineRefreshIntervalMs,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    });
    rendererRef.current = renderer;

    if (!renderer.supported) {
      setSupported(false);
      return () => {
        renderer.destroy();
        rendererRef.current = null;
      };
    }

    setSupported(true);

    const measure = () => {
      const bounds = container.getBoundingClientRect();
      renderer.resize(
        Math.max(1, bounds.width),
        Math.max(1, bounds.height),
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      );
    };

    measure();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(container);
    }
    window.addEventListener("resize", measure);

    const pointers = new Map<number, Point>();
    let pinch: PinchState | null = null;
    let panPointerId: number | null = null;

    const localPoint = (event: PointerEvent | WheelEvent): Point => {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
    };

    const beginPinch = () => {
      const [first, second] = Array.from(pointers.values());
      if (!first || !second) {
        pinch = null;
        return;
      }
      const center = midpoint(first, second);
      pinch = {
        distance: distanceBetween(first, second),
        centerX: center.x,
        centerY: center.y,
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      const point = localPoint(event);
      pointers.set(event.pointerId, point);

      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort (unsupported in some browsers/tests).
      }

      if (pointers.size === 1) {
        panPointerId = event.pointerId;
        renderer.setPointer(point.x, point.y);
        renderer.beginPan(point.x, point.y);
      } else if (pointers.size === 2) {
        panPointerId = null;
        renderer.endPan();
        beginPinch();
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const point = localPoint(event);
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, point);
      }
      renderer.setPointer(point.x, point.y);

      if (pointers.size >= 2 && pinch) {
        const [first, second] = Array.from(pointers.values());
        if (!first || !second) return;

        const nextDistance = distanceBetween(first, second);
        const center = midpoint(first, second);

        if (pinch.distance > 0 && nextDistance > 0) {
          renderer.zoomAt(
            center.x,
            center.y,
            nextDistance / pinch.distance,
          );
        }
        renderer.panBy(
          center.x - pinch.centerX,
          center.y - pinch.centerY,
        );

        pinch = {
          distance: nextDistance,
          centerX: center.x,
          centerY: center.y,
        };
        return;
      }

      if (panPointerId === event.pointerId) {
        renderer.movePan(point.x, point.y);
      }
    };

    const finishPointer = (event: PointerEvent) => {
      pointers.delete(event.pointerId);

      if (panPointerId === event.pointerId) {
        panPointerId = null;
        renderer.endPan();
      }

      if (pointers.size < 2) {
        pinch = null;
      }

      if (pointers.size === 1) {
        const [id, point] = Array.from(pointers.entries())[0];
        panPointerId = id;
        renderer.beginPan(point.x, point.y);
      }
    };

    const handlePointerLeave = () => {
      if (pointers.size === 0) {
        renderer.clearPointer();
      }
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(event);
      const factor = Math.exp(-event.deltaY * 0.0015);
      renderer.zoomAt(point.x, point.y, factor);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    let animationFrame = 0;
    let lastFrame =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let elapsedSeconds = 0;
    let fpsFrames = 0;
    let fpsElapsed = 0;

    const frame = (now: number) => {
      const deltaSeconds = Math.min(
        0.05,
        Math.max(0.001, (now - lastFrame) / 1000),
      );
      lastFrame = now;
      elapsedSeconds += deltaSeconds;

      renderer.tick(deltaSeconds, elapsedSeconds);
      renderer.render();

      fpsFrames += 1;
      fpsElapsed += deltaSeconds;
      if (fpsElapsed >= 0.5) {
        const sample = Math.round(fpsFrames / fpsElapsed);
        setFps(sample);
        onFpsSample?.(sample);
        fpsFrames = 0;
        fpsElapsed = 0;
      }

      animationFrame = requestAnimationFrame(frame);
    };

    if (typeof requestAnimationFrame === "function") {
      animationFrame = requestAnimationFrame(frame);
    }

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("wheel", handleWheel);

      renderer.destroy();
      rendererRef.current = null;
    };
  }, [
    connectionDistance,
    lineRefreshIntervalMs,
    maxConnectionsPerNode,
    nodeCount,
    nodes,
    onFpsSample,
    seed,
  ]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-[#02040a] ${className ?? ""}`}
      data-testid="particle-constellation"
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
        role="img"
        aria-label="Real-time WebGL constellation of nomad social connections, skill exchanges and coworking circles"
        data-testid="particle-constellation-canvas"
      />

      {showHud && supported && (
        <div className="pointer-events-none absolute inset-0 select-none">
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-slate-950/70 px-3 py-1.5 font-mono text-[11px] text-cyan-200 backdrop-blur">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
            <span>{fps} FPS</span>
            <span className="text-cyan-500/60">|</span>
            <span>{nodeCount.toLocaleString()} NODES</span>
          </div>

          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-full border border-white/10 bg-slate-950/60 px-4 py-1.5 font-mono text-[10px] text-slate-300 backdrop-blur">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
              NOMAD
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-pink-400" />
              COWORKING HUB
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              SKILL EXCHANGE
            </span>
            <span className="text-slate-500">
              drag to pan · scroll / pinch to zoom
            </span>
          </div>
        </div>
      )}

      {!supported && (
        <div
          className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-slate-400"
          role="status"
        >
          WebGL 2.0 is required to render the live nomad constellation.
        </div>
      )}
    </div>
  );
}

export default ParticleConstellation;
