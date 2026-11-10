"use client";

import React, { useEffect, useState, useRef } from "react";
import { TrendingUp, Users, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { createForecastingWorker } from "./createForecastingWorker";

export interface CrowdForecastChartProps {
  venueId: string;
  weatherScore?: number;
  eventImpact?: number;
  className?: string;
  "data-testid"?: string;
  initialPredictions?: number[];
  showPeak?: boolean;
  createWorker?: () => Worker;
}

export function CrowdForecastChart({
  venueId,
  weatherScore = 0.8,
  eventImpact = 0.3,
  className,
  "data-testid": dataTestId,
  initialPredictions,
  showPeak = true,
  createWorker,
}: CrowdForecastChartProps) {
  const [predictions, setPredictions] = useState<number[]>(() => {
    if (Array.isArray(initialPredictions) && initialPredictions.length > 0) {
      return initialPredictions;
    }
    return [];
  });
  const [loading, setLoading] = useState<boolean>(() => {
    return !Array.isArray(initialPredictions) || initialPredictions.length === 0;
  });

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    // If initial predictions were provided, don't re-run worker unless venueId changes
    if (Array.isArray(initialPredictions) && initialPredictions.length > 0) {
      setLoading(false);
      setPredictions(initialPredictions);
      return;
    }

    setLoading(true);

    // Mock historical 24h baseline telemetry
    const historicalTelemetry = Array.from(
      { length: 24 },
      (_, i) => Math.sin((i / 24) * Math.PI * 2 - Math.PI / 2) * 0.4 + 0.5,
    );

    // Fallback prediction calculation
    const computeFallback = () =>
      historicalTelemetry.map((val) =>
        Math.min(
          100,
          Math.max(10, Math.round((val + weatherScore * 0.2 + eventImpact * 0.1) * 100)),
        ),
      );

    // Worker safety check for Node, Jest, or unsupported environments
    const hasWorkerSupport = Boolean(
      createWorker ||
      (typeof window !== "undefined" && typeof Worker !== "undefined"),
    );
    if (!hasWorkerSupport) {
      if (isMountedRef.current) {
        setPredictions(computeFallback());
        setLoading(false);
      }
      return;
    }

    let worker: Worker | null = null;
    let throttleTimeout: ReturnType<typeof setTimeout> | null = null;
    let terminationTimeout: ReturnType<typeof setTimeout> | null = null;

    try {
      const workerFactory = createWorker || createForecastingWorker;
      worker = workerFactory();

      // Message queue throttling: Delay the postMessage to avoid concurrent rapid lockups
      throttleTimeout = setTimeout(() => {
        worker?.postMessage({
          venueId,
          historicalTelemetry,
          weatherScore,
          eventImpact,
        });
      }, 300); // 300ms throttle

      // Explicit worker termination timeout
      terminationTimeout = setTimeout(() => {
        console.warn("Worker termination timeout exceeded");
        worker?.terminate();
        if (isMountedRef.current) {
          setPredictions(computeFallback());
          setLoading(false);
        }
      }, 15000); // 15 seconds

      worker.onmessage = (e: MessageEvent) => {
        if (terminationTimeout) clearTimeout(terminationTimeout);
        if (isMountedRef.current) {
          if (e.data?.success && Array.isArray(e.data?.predictions)) {
            setPredictions(e.data.predictions);
          } else {
            setPredictions(computeFallback());
          }
          setLoading(false);
        }
        worker?.terminate();
      };

      worker.onerror = () => {
        if (terminationTimeout) clearTimeout(terminationTimeout);
        if (isMountedRef.current) {
          setPredictions(computeFallback());
          setLoading(false);
        }
        worker?.terminate();
      };
    } catch {
      if (isMountedRef.current) {
        setPredictions(computeFallback());
        setLoading(false);
      }
    }

    return () => {
      isMountedRef.current = false;
      if (throttleTimeout) clearTimeout(throttleTimeout);
      if (terminationTimeout) clearTimeout(terminationTimeout);
      worker?.terminate();
    };
  }, [venueId, weatherScore, eventImpact, initialPredictions]);

  const peakPercentage = predictions.length ? Math.max(...predictions) : null;

  return (
    <div
      data-testid={dataTestId || "crowd-forecast-chart"}
      className={cn("glass-card rounded-2xl p-5 border border-white/10 bg-black/40", className)}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <TrendingUp className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
              Predictive Foot-Traffic (24h)
            </h4>
            <p className="text-[10px] text-zinc-500 flex items-center gap-1">
              <Cpu className="w-3 h-3 text-emerald-400" /> ONNX WebAssembly
              Model (Client-Side)
            </p>
          </div>
        </div>
        {showPeak && (
          <div
            data-testid="crowd-forecast-peak"
            className="flex items-center gap-1.5 text-xs font-mono text-purple-300 bg-purple-500/10 px-2 py-1 rounded-md border border-purple-500/20"
          >
            <Users className="w-3.5 h-3.5" />
            <span>
              Peak: {peakPercentage !== null ? `${Math.round(peakPercentage)}%` : "--"}
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div
          data-testid="crowd-forecast-loading"
          className="h-28 flex items-center justify-center text-xs text-zinc-500 animate-pulse"
        >
          Running WASM neural inference...
        </div>
      ) : (
        <div
          data-testid="crowd-forecast-bars"
          className="h-28 flex items-end gap-1 pt-4 px-1 border-b border-white/10"
        >
          {predictions.map((value, hr) => (
            <div
              key={hr}
              data-testid={`crowd-forecast-bar-${hr}`}
              className="flex-1 flex flex-col items-center gap-1 group relative"
            >
              <div
                className="w-full rounded-t-sm transition-all duration-300 bg-gradient-to-t from-purple-600/40 to-purple-400 group-hover:from-purple-500 group-hover:to-pink-400"
                style={{ height: `${Math.min(100, Math.max(4, value))}%` }}
              />
              <div className="absolute -top-7 hidden group-hover:flex bg-zinc-900 border border-white/20 text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg z-20 whitespace-nowrap">
                {hr}:00 — {Math.round(value)}% capacity
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between text-[9px] font-mono text-zinc-600 mt-2 px-0.5">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
    </div>
  );
}

export default CrowdForecastChart;
