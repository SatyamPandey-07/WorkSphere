"use client";

import React from "react";
import {
  Battery,
  BatteryCharging,
  BatteryWarning,
  Cpu,
  Gauge,
  Sparkles,
  Zap,
  RotateCcw,
  Check,
} from "lucide-react";
import { useBatteryLowPowerThrottle } from "@/hooks/useBatteryLowPowerThrottle";
import { type PowerMode } from "@/lib/power/lowPowerThrottle";

export interface LowPowerModeIndicatorProps {
  className?: string;
  showControls?: boolean;
  compact?: boolean;
}

/**
 * LowPowerModeIndicator
 * Aerospace-grade cockpit telemetry HUD reflecting real-time battery status,
 * WebGL requestAnimationFrame FPS ceilings, and AudioWorklet IPC telemetry decimation.
 */
export function LowPowerModeIndicator({
  className = "",
  showControls = true,
  compact = false,
}: LowPowerModeIndicatorProps) {
  const {
    mode,
    isLowPower,
    isCritical,
    webglPolicy,
    audioWorkletPolicy,
    batteryLevel,
    charging,
    manualOverride,
    setManualOverride,
    optimalDpr,
  } = useBatteryLowPowerThrottle();

  const safeBatteryLevel =
    typeof batteryLevel === "number" && Number.isFinite(batteryLevel)
      ? Math.max(0, Math.min(1, batteryLevel))
      : null;

  const batteryPercent =
    safeBatteryLevel !== null ? Math.round(safeBatteryLevel * 100) : null;

  const telemetryHz =
    typeof audioWorkletPolicy.telemetryIntervalMs === "number" &&
    audioWorkletPolicy.telemetryIntervalMs > 0 &&
    Number.isFinite(audioWorkletPolicy.telemetryIntervalMs)
      ? Math.round(1000 / audioWorkletPolicy.telemetryIntervalMs)
      : 0;

  const modeBadgeColor = isCritical
    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
    : isLowPower
    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
    : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";

  if (compact) {
    return (
      <div
        role="status"
        aria-label="Power Mode Status"
        data-testid="low-power-indicator-compact"
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold transition-all backdrop-blur-md ${modeBadgeColor} ${className}`}
      >
        {charging ? (
          <BatteryCharging className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : isCritical ? (
          <BatteryWarning className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
        ) : (
          <Battery className="w-4 h-4 shrink-0" />
        )}
        <span>
          {batteryPercent !== null ? `${batteryPercent}%` : "AC"} ·{" "}
          {webglPolicy.targetFps} FPS · {audioWorkletPolicy.dspQuality.toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Battery-Aware Power Throttling Telemetry"
      data-testid="low-power-mode-indicator"
      className={`p-4 rounded-2xl bg-zinc-950/90 border border-emerald-500/30 text-zinc-100 font-mono shadow-xl backdrop-blur-md select-none w-full max-w-xl mx-auto ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div
            className={`p-1.5 rounded-lg border ${
              isCritical
                ? "bg-rose-950 text-rose-400 border-rose-500/40"
                : isLowPower
                ? "bg-amber-950 text-amber-400 border-amber-500/40"
                : "bg-emerald-950 text-emerald-400 border-emerald-500/40"
            }`}
          >
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>Energy Telemetry &amp; Hardware Throttling</span>
              <span
                data-testid="power-mode-badge"
                className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${modeBadgeColor}`}
              >
                {mode.replace("_", " ")}
              </span>
            </div>
            <div className="text-[10px] text-zinc-400">
              {manualOverride ? "MANUAL OVERRIDE ACTIVE" : "AUTONOMOUS BATTERY SENSING"}
            </div>
          </div>
        </div>

        {/* Battery Charge State Badge */}
        <div
          data-testid="power-battery-level"
          className="flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800"
        >
          {charging ? (
            <>
              <BatteryCharging className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span data-testid="power-charging-state" className="text-emerald-400">
                CHARGING {batteryPercent !== null && `(${batteryPercent}%)`}
              </span>
            </>
          ) : isCritical ? (
            <>
              <BatteryWarning className="w-4 h-4 text-rose-400 animate-bounce" />
              <span data-testid="power-charging-state" className="text-rose-400">
                CRITICAL ({batteryPercent}%)
              </span>
            </>
          ) : (
            <>
              <Battery className="w-4 h-4 text-zinc-300" />
              <span data-testid="power-charging-state" className="text-zinc-300">
                {batteryPercent !== null ? `${batteryPercent}% BATTERY` : "LINE POWER"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Hardware Throttling Policies Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        {/* WebGL Policy Card */}
        <div
          data-testid="webgl-fps-throttle"
          className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-400 flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-cyan-400" />
              <span>WebGL Render Loop</span>
            </span>
            <span
              data-testid="webgl-fps-value"
              className={`font-black ${
                isCritical
                  ? "text-rose-400"
                  : isLowPower
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}
            >
              {webglPolicy.targetFps} FPS
            </span>
          </div>
          <div className="text-[11px] text-zinc-300 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-zinc-500">Target Interval:</span>
              <span>{webglPolicy.frameIntervalMs.toFixed(1)} ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">DPR Clamp Ceiling:</span>
              <span>
                {optimalDpr.toFixed(1)}x (max {webglPolicy.maxDpr}x)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Post-FX (Bloom/Rays):</span>
              <span className={webglPolicy.enablePostProcessing ? "text-emerald-400" : "text-amber-400"}>
                {webglPolicy.enablePostProcessing ? "ENABLED" : "BYPASS (ECO)"}
              </span>
            </div>
          </div>
        </div>

        {/* AudioWorklet Policy Card */}
        <div
          data-testid="audioworklet-telemetry-rate"
          className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-400 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-purple-400" />
              <span>AudioWorklet DSP Thread</span>
            </span>
            <span
              data-testid="audioworklet-dsp-quality"
              className={`font-black uppercase ${
                isCritical
                  ? "text-rose-400"
                  : isLowPower
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}
            >
              {audioWorkletPolicy.dspQuality}
            </span>
          </div>
          <div className="text-[11px] text-zinc-300 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-zinc-500">IPC Telemetry Rate:</span>
              <span>
                {audioWorkletPolicy.enableTelemetry && telemetryHz > 0
                  ? `${audioWorkletPolicy.telemetryIntervalMs} ms (~${telemetryHz} Hz)`
                  : "DISABLED (ZERO IPC)"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Non-Essential DSP:</span>
              <span
                className={
                  audioWorkletPolicy.bypassNonEssential
                    ? "text-rose-400"
                    : "text-emerald-400"
                }
              >
                {audioWorkletPolicy.bypassNonEssential ? "BYPASSED" : "ACTIVE"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">SIMD Vectoring:</span>
              <span className="text-cyan-400">128-BIT ACTIVE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mode Controls */}
      {showControls && (
        <div className="pt-2 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-[10px] text-zinc-400">SELECT OPERATIONAL TIER:</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              data-testid="power-mode-normal-btn"
              aria-pressed={mode === "normal" && manualOverride === "normal"}
              onClick={() => setManualOverride("normal")}
              className={`px-2.5 py-1 rounded-lg font-bold border transition-colors ${
                mode === "normal" && manualOverride === "normal"
                  ? "bg-emerald-600 text-white border-emerald-400 shadow-sm"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
              }`}
            >
              Full (60 FPS)
            </button>
            <button
              type="button"
              data-testid="power-mode-low-btn"
              aria-pressed={mode === "low_power" && manualOverride === "low_power"}
              onClick={() => setManualOverride("low_power")}
              className={`px-2.5 py-1 rounded-lg font-bold border transition-colors ${
                mode === "low_power" && manualOverride === "low_power"
                  ? "bg-amber-600 text-white border-amber-400 shadow-sm"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
              }`}
            >
              Low-Power (30 FPS)
            </button>
            <button
              type="button"
              data-testid="power-mode-critical-btn"
              aria-pressed={mode === "critical" && manualOverride === "critical"}
              onClick={() => setManualOverride("critical")}
              className={`px-2.5 py-1 rounded-lg font-bold border transition-colors ${
                mode === "critical" && manualOverride === "critical"
                  ? "bg-rose-600 text-white border-rose-400 shadow-sm"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
              }`}
            >
              Critical (15 FPS)
            </button>
            {manualOverride && (
              <button
                type="button"
                data-testid="power-mode-auto-btn"
                aria-label="Reset to autonomous battery sensing"
                onClick={() => setManualOverride(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
                title="Reset to autonomous battery sensing"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Auto</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LowPowerModeIndicator;
