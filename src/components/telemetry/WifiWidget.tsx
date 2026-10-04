"use client";

import React from "react";
import { Wifi, Activity, ShieldCheck, AlertCircle, ArrowUpRight } from "lucide-react";
import { useSmoothTelemetry } from "@/lib/telemetry";

export interface WifiWidgetProps {
  /** Raw instantaneous speed in Mbps */
  rawSpeedMbps: number;
  /** Latency ping in ms */
  pingMs?: number;
  /** Packet jitter in ms */
  jitterMs?: number;
  /** Optional venue or hotspot name */
  venueName?: string;
  /** Optional CSS class overrides */
  className?: string;
  /** Smoothing parameter alpha in range [0.1, 0.4] */
  smoothingAlpha?: number;
}

export function getSpeedTier(speedMbps: number): {
  tier: string;
  color: string;
  badgeBg: string;
} {
  if (speedMbps >= 100) {
    return {
      tier: "Ultra Fast",
      color: "text-emerald-500 dark:text-emerald-400",
      badgeBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    };
  }
  if (speedMbps >= 40) {
    return {
      tier: "High Speed",
      color: "text-blue-500 dark:text-blue-400",
      badgeBg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    };
  }
  if (speedMbps >= 15) {
    return {
      tier: "Moderate",
      color: "text-amber-500 dark:text-amber-400",
      badgeBg: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    };
  }
  return {
    tier: "Basic",
    color: "text-rose-500 dark:text-rose-400",
    badgeBg: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  };
}

export function WifiWidget({
  rawSpeedMbps,
  pingMs = 18,
  jitterMs = 2,
  venueName,
  className = "",
  smoothingAlpha = 0.25,
}: WifiWidgetProps) {
  const { smoothedSpeed, isOutlier, history } = useSmoothTelemetry(
    rawSpeedMbps,
    { alpha: smoothingAlpha },
  );

  const tierInfo = getSpeedTier(smoothedSpeed);

  return (
    <div
      data-testid="wifi-telemetry-widget"
      className={`relative overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm transition-all ${className}`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/50">
            <Wifi className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Live WiFi Telemetry
            </h4>
            {venueName && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[180px]">
                {venueName}
              </p>
            )}
          </div>
        </div>

        <span
          data-testid="wifi-speed-tier"
          className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${tierInfo.badgeBg}`}
        >
          {tierInfo.tier}
        </span>
      </div>

      {/* Main Metric: Smoothed Speed */}
      <div className="flex items-baseline gap-2 mb-3">
        <span
          data-testid="smoothed-speed-value"
          className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white tabular-nums transition-all"
        >
          {smoothedSpeed.toFixed(1)}
        </span>
        <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          Mbps
        </span>

        {/* 3-Sigma Outlier Indicator */}
        {isOutlier && (
          <span
            data-testid="outlier-badge"
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse"
          >
            <AlertCircle className="w-3 h-3" />
            Filtered 3σ Spike
          </span>
        )}
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-3 gap-2 py-3 border-t border-zinc-100 dark:border-zinc-800/80 text-xs">
        <div>
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block">
            Raw Ping
          </span>
          <span
            data-testid="raw-speed-metric"
            className="font-bold text-zinc-700 dark:text-zinc-300 tabular-nums"
          >
            {rawSpeedMbps.toFixed(0)} Mbps
          </span>
        </div>
        <div>
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block">
            Latency
          </span>
          <span className="font-bold text-zinc-700 dark:text-zinc-300 tabular-nums">
            {pingMs} ms
          </span>
        </div>
        <div>
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block">
            Jitter
          </span>
          <span className="font-bold text-zinc-700 dark:text-zinc-300 tabular-nums">
            ±{jitterMs} ms
          </span>
        </div>
      </div>

      {/* Historical Sparkline Bar */}
      {history.length > 1 && (
        <div
          data-testid="telemetry-sparkline"
          className="mt-2 flex items-end gap-1 h-5 pt-1"
        >
          {history.map((val, idx) => {
            const maxVal = Math.max(...history, 1);
            const heightPct = Math.min(100, Math.max(15, (val / maxVal) * 100));
            return (
              <div
                key={idx}
                className="flex-1 rounded-sm bg-blue-500/30 dark:bg-blue-400/20 hover:bg-blue-500 transition-all"
                style={{ height: `${heightPct}%` }}
                title={`${val.toFixed(1)} Mbps`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
