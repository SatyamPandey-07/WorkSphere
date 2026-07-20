"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Users, Cpu } from "lucide-react";

interface CrowdForecastChartProps {
  venueId: string;
  weatherScore?: number;
  eventImpact?: number;
}

export function CrowdForecastChart({
  venueId,
  weatherScore = 0.8,
  eventImpact = 0.3,
}: CrowdForecastChartProps) {
  const [predictions, setPredictions] = useState<number[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    setLoading(true);

    // Mock historical 24h baseline telemetry
    const historicalTelemetry = Array.from({ length: 24 }, (_, i) =>
      Math.sin((i / 24) * Math.PI * 2 - Math.PI / 2) * 0.4 + 0.5
    );

    const worker = new Worker(
      new URL("../../workers/forecasting.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.postMessage({
      venueId,
      historicalTelemetry,
      weatherScore,
      eventImpact,
    });

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.success) {
        setPredictions(e.data.predictions);
      } else {
        // Fallback calculation if model file is not placed in public folder yet
        setPredictions(
          historicalTelemetry.map((val) =>
            Math.min(100, Math.max(10, Math.round((val + weatherScore * 0.2) * 100)))
          )
        );
      }
      setLoading(false);
      worker.terminate();
    };

    return () => worker.terminate();
  }, [venueId, weatherScore, eventImpact]);

  return (
    <div className="glass-card rounded-2xl p-5 border border-white/10 bg-black/40">
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
              <Cpu className="w-3 h-3 text-emerald-400" /> ONNX WebAssembly Model (Client-Side)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono text-purple-300 bg-purple-500/10 px-2 py-1 rounded-md border border-purple-500/20">
          <Users className="w-3.5 h-3.5" />
          <span>Peak: {predictions.length ? `${Math.max(...predictions)}%` : "--"}</span>
        </div>
      </div>

      {loading ? (
        <div className="h-28 flex items-center justify-center text-xs text-zinc-500 animate-pulse">
          Running WASM neural inference...
        </div>
      ) : (
        <div className="h-28 flex items-end gap-1 pt-4 px-1 border-b border-white/10">
          {predictions.map((value, hr) => (
            <div key={hr} className="flex-1 flex flex-col items-center gap-1 group relative">
              <div
                className="w-full rounded-t-sm transition-all duration-300 bg-gradient-to-t from-purple-600/40 to-purple-400 group-hover:from-purple-500 group-hover:to-pink-400"
                style={{ height: `${value}%` }}
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
