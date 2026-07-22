"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Users, Zap, Monitor } from "lucide-react";
import {
  CrowdSimulationEngine,
  type SimulationConfig,
} from "@/lib/webgpu/crowdSimulation";
import { CrowdFallbackRenderer } from "@/lib/webgpu/crowdFallback";

interface CrowdEvacuationProps {
  width?: number;
  height?: number;
  maxAgents?: number;
  exitPositions?: [number, number][];
  wallSegments?: Array<{ a: [number, number]; b: [number, number] }>;
}

const DEFAULT_EXITS: [number, number][] = [
  [5, 0],
  [45, 0],
  [25, 50],
];

const DEFAULT_WALLS: Array<{ a: [number, number]; b: [number, number] }> = [
  { a: [0, 0], b: [50, 0] },
  { a: [50, 0], b: [50, 50] },
  { a: [50, 50], b: [0, 50] },
  { a: [0, 50], b: [0, 0] },
  // Internal obstacle
  { a: [15, 20], b: [35, 20] },
  { a: [35, 20], b: [35, 30] },
  { a: [35, 30], b: [15, 30] },
  { a: [15, 30], b: [15, 20] },
];

export function CrowdEvacuation({
  width = 800,
  height = 500,
  maxAgents = 50000,
  exitPositions = DEFAULT_EXITS,
  wallSegments = DEFAULT_WALLS,
}: CrowdEvacuationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CrowdSimulationEngine | null>(null);
  const fallbackRef = useRef<CrowdFallbackRenderer | null>(null);

  const [isPaused, setIsPaused] = useState(false);
  const [evacuated, setEvacuated] = useState(0);
  const [fps, setFps] = useState(0);
  const [rendererMode, setRendererMode] = useState<string>("detecting");
  const [agentCount, setAgentCount] = useState(maxAgents);

  const config: SimulationConfig = useMemo(
    () => ({
      agentCount,
      worldWidth: 50,
      worldHeight: 50,
      exitPositions,
      wallSegments,
    }),
    [agentCount, exitPositions, wallSegments],
  );

  const initEngine = useCallback(async () => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;

    // Try WebGPU first
    if (navigator.gpu) {
      try {
        const engine = new CrowdSimulationEngine(canvas, config);
        const success = await engine.initialize();
        if (success) {
          engineRef.current = engine;
          setRendererMode("WebGPU Compute");

          let frameCount = 0;
          let lastFpsTime = performance.now();

          engine.onFrame((_agents, evac) => {
            setEvacuated(evac);
            frameCount++;
            const now = performance.now();
            if (now - lastFpsTime >= 1000) {
              setFps(frameCount);
              frameCount = 0;
              lastFpsTime = now;
            }
          });

          engine.startRenderLoop();
          return;
        }
        engine.destroy();
      } catch (e) {
        console.warn("[CrowdEvacuation] WebGPU init failed, falling back:", e);
      }
    }

    // Fallback to WebGL 2.0
    const fallback = new CrowdFallbackRenderer(canvas, config);
    const success = fallback.initialize();
    if (success) {
      fallbackRef.current = fallback;
      setRendererMode("WebGL 2.0 Fallback");

      let frameCount = 0;
      let lastFpsTime = performance.now();

      fallback.onFrame((_agents, evac) => {
        setEvacuated(evac);
        frameCount++;
        const now = performance.now();
        if (now - lastFpsTime >= 1000) {
          setFps(frameCount);
          frameCount = 0;
          lastFpsTime = now;
        }
      });

      fallback.startRenderLoop();
    } else {
      setRendererMode("Unsupported");
    }
  }, [config]);

  useEffect(() => {
    initEngine();
    return () => {
      engineRef.current?.destroy();
      fallbackRef.current?.destroy();
    };
  }, [initEngine]);

  const handlePause = useCallback(() => {
    if (isPaused) {
      engineRef.current?.startRenderLoop();
      fallbackRef.current?.startRenderLoop();
    } else {
      engineRef.current?.stopRenderLoop();
      fallbackRef.current?.stopRenderLoop();
    }
    setIsPaused(!isPaused);
  }, [isPaused]);

  const handleReset = useCallback(() => {
    engineRef.current?.reset();
    fallbackRef.current?.reset();
    setEvacuated(0);
    if (isPaused) {
      engineRef.current?.startRenderLoop();
      fallbackRef.current?.startRenderLoop();
      setIsPaused(false);
    }
  }, [isPaused]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-white">
            Crowd Evacuation Simulation
          </h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Monitor className="h-3 w-3" />
          <span>{rendererMode}</span>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="block w-full"
          style={{ background: "#0f0f1a" }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePause}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-white transition-colors"
          >
            {isPaused ? (
              <Play className="h-3 w-3" />
            ) : (
              <Pause className="h-3 w-3" />
            )}
            {isPaused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-white transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Zap className="h-3 w-3 text-yellow-400" />
            <span>{fps} FPS</span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Users className="h-3 w-3 text-green-400" />
            <span>
              {evacuated.toLocaleString()} / {agentCount.toLocaleString()}{" "}
              evacuated
            </span>
          </div>
        </div>
      </div>

      {/* Agent count slider */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-3">
          <label
            htmlFor="agent-count"
            className="text-xs text-zinc-400 whitespace-nowrap"
          >
            Agents:
          </label>
          <input
            id="agent-count"
            type="range"
            min={1000}
            max={maxAgents}
            step={1000}
            value={agentCount}
            onChange={(e) => setAgentCount(Number(e.target.value))}
            className="flex-1 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
          />
          <span className="text-xs text-white w-16 text-right">
            {agentCount >= 1000
              ? `${(agentCount / 1000).toFixed(0)}K`
              : agentCount}
          </span>
        </div>
      </div>
    </div>
  );
}
