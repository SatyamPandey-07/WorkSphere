"use client";

import React, { useState, useId } from "react";
import {
  Wind,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Info,
  Thermometer,
  Droplets,
  Activity,
  DoorOpen,
  X,
} from "lucide-react";

export type Co2SafetyStatus = "optimal" | "moderate" | "poor";

export interface Co2Evaluation {
  status: Co2SafetyStatus;
  badgeText: string;
  badgeColorClass: string;
  isWarning: boolean;
  isCritical: boolean;
  recommendation: string;
}

/**
 * Evaluates indoor CO2 concentrations against environmental safety thresholds:
 * - Green (<800 PPM): Optimal indoor air, peak cognitive performance.
 * - Amber (800-1200 PPM): Moderate air quality; drowsiness begins to emerge above 1000 PPM.
 * - Red (>1200 PPM): Stagnant air; cognitive impairment alert triggered at >=1500 PPM.
 */
export function evaluateCo2Threshold(co2Ppm: number): Co2Evaluation {
  if (co2Ppm < 800) {
    return {
      status: "optimal",
      badgeText: "Optimal (<800 PPM)",
      badgeColorClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
      isWarning: false,
      isCritical: false,
      recommendation: "Indoor air is clean and well-ventilated. Peak cognitive focus.",
    };
  }

  if (co2Ppm <= 1200) {
    const isWarning = co2Ppm > 1000;
    return {
      status: "moderate",
      badgeText: "Moderate (800-1200 PPM)",
      badgeColorClass: "bg-amber-500/10 text-amber-400 border-amber-500/30",
      isWarning,
      isCritical: false,
      recommendation: isWarning
        ? "CO2 exceeds 1,000 PPM. Moderate drowsiness detected; consider opening windows or increasing ventilation."
        : "Acceptable air quality for short-term working sessions.",
    };
  }

  const isCritical = co2Ppm >= 1500;
  return {
    status: "poor",
    badgeText: "High Risk (>1200 PPM)",
    badgeColorClass: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    isWarning: true,
    isCritical,
    recommendation: isCritical
      ? "Critical threshold breached! Significant cognitive impairment and fatigue. Open windows immediately or switch rooms."
      : "Stale indoor air detected. Occupants may feel lethargic and lose focus.",
  };
}

export interface IndoorAirQualityCardProps {
  co2Ppm: number;
  temperatureC?: number;
  humidityPercent?: number;
  tvocPpb?: number;
  pm25?: number;
  venueName?: string;
  roomName?: string;
  lastUpdated?: string;
  className?: string;
}

export default function IndoorAirQualityCard({
  co2Ppm,
  temperatureC,
  humidityPercent,
  tvocPpb,
  pm25,
  venueName = "Workspace Main Area",
  roomName = "Open Coworking Zone",
  lastUpdated = "Live",
  className = "",
}: IndoorAirQualityCardProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const tooltipId = useId();

  const evaluation = evaluateCo2Threshold(co2Ppm);
  const showBanner = evaluation.isWarning && !bannerDismissed;

  // Percentage bar based on 400 - 2000 PPM scale
  const progressPercent = Math.min(
    100,
    Math.max(0, ((co2Ppm - 400) / (2000 - 400)) * 100),
  );

  return (
    <div
      data-testid="indoor-air-quality-card"
      className={`rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 backdrop-blur-md shadow-xl text-zinc-100 ${className}`}
    >
      {/* Top Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <Wind className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-wide text-zinc-200">
                Indoor Air Quality
              </h3>
              <p className="text-xs text-zinc-400">
                {roomName} • {venueName}
              </p>
            </div>
          </div>
        </div>

        {/* Live Indicator & Safety Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-mono">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
            </span>
            {lastUpdated}
          </div>

          <div
            data-testid="co2-status-badge"
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${evaluation.badgeColorClass} flex items-center gap-1.5`}
          >
            {evaluation.status === "optimal" && (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {evaluation.status === "moderate" && (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            {evaluation.status === "poor" && (
              <AlertOctagon className="h-3.5 w-3.5" />
            )}
            <span>{evaluation.badgeText}</span>
          </div>
        </div>
      </div>

      {/* Main Metric Display */}
      <div className="mt-5 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span
            data-testid="co2-value"
            className="text-4xl font-extrabold tracking-tight font-mono text-zinc-50"
          >
            {co2Ppm.toLocaleString()}
          </span>
          <span className="text-sm font-medium text-zinc-400">PPM CO₂</span>
        </div>

        {/* Cognitive Impact Tooltip Trigger */}
        <div className="relative">
          <button
            type="button"
            id="co2-info-button"
            aria-describedby={showTooltip ? tooltipId : undefined}
            aria-label="Cognitive impact of CO2 concentrations"
            data-testid="co2-tooltip-trigger"
            onClick={() => setShowTooltip((prev) => !prev)}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onFocus={() => setShowTooltip(true)}
            onBlur={() => setShowTooltip(false)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors border border-transparent hover:border-zinc-700"
          >
            <Info className="h-3.5 w-3.5 text-teal-400" />
            <span>Cognitive Impact</span>
          </button>

          {/* Accessible Tooltip Popup */}
          {showTooltip && (
            <div
              id={tooltipId}
              role="tooltip"
              data-testid="co2-cognitive-tooltip"
              className="absolute right-0 bottom-full mb-2 z-50 w-72 rounded-xl border border-zinc-700 bg-zinc-900/95 p-3.5 text-xs text-zinc-200 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="font-semibold text-zinc-100 flex items-center gap-1.5 pb-1.5 border-b border-zinc-800">
                <Activity className="h-3.5 w-3.5 text-teal-400" />
                <span>CO₂ Cognitive Impact Guide</span>
              </div>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
                <li className="flex items-start gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1 shrink-0"></span>
                  <span>
                    <strong className="text-emerald-400">&lt; 800 PPM:</strong>{" "}
                    Optimal clarity, alertness, and strategic thinking.
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1 shrink-0"></span>
                  <span>
                    <strong className="text-amber-400">&gt; 1,000 PPM:</strong>{" "}
                    Moderate drowsiness, slower reflexes, and slight lethargy.
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400 mt-1 shrink-0"></span>
                  <span>
                    <strong className="text-rose-400">&ge; 1,500 PPM:</strong>{" "}
                    Significant cognitive impairment (Harvard study: ~50% drop
                    in complex decision-making).
                  </span>
                </li>
              </ul>
              <div className="mt-2.5 pt-2 border-t border-zinc-800 text-[10px] text-zinc-400">
                Data based on ASHRAE 62.1 &amp; Harvard T.H. Chan environmental
                health benchmarks.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar Gauge */}
      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800/80">
          <div
            className={`h-full transition-all duration-500 ${
              evaluation.status === "optimal"
                ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                : evaluation.isCritical
                  ? "bg-gradient-to-r from-amber-500 to-rose-500"
                  : "bg-gradient-to-r from-teal-400 to-amber-500"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-mono text-zinc-500">
          <span>400 (Outdoor)</span>
          <span>800 (Threshold)</span>
          <span>1,200 (Stale)</span>
          <span>2,000+</span>
        </div>
      </div>

      {/* Prominent Warning Banner (>1000 PPM or >=1500 PPM) */}
      {showBanner && (
        <div
          data-testid="co2-warning-banner"
          role="alert"
          className={`mt-4 rounded-xl border p-3.5 transition-all animate-in fade-in slide-in-from-top-2 duration-200 ${
            evaluation.isCritical
              ? "bg-rose-950/40 border-rose-500/40 text-rose-200"
              : "bg-amber-950/40 border-amber-500/40 text-amber-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              {evaluation.isCritical ? (
                <AlertOctagon className="h-5 w-5 text-rose-400 mt-0.5 shrink-0 animate-pulse" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
              )}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider">
                  {evaluation.isCritical
                    ? "Critical CO₂ Threshold Breached (Cognitive Impairment)"
                    : "Elevated CO₂ Warning (Moderate Drowsiness)"}
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                  {evaluation.isCritical
                    ? "Indoor CO₂ has reached dangerous levels (≥1,500 PPM). High risk of severe brain fog, headaches, and impaired task performance. Strongly advised to open all windows immediately or switch rooms."
                    : "Indoor CO₂ has exceeded 1,000 PPM. You may experience drowsiness, sluggishness, and reduced focus. Advised to open windows, turn on air conditioning, or take a fresh-air break."}
                </p>
                <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-zinc-100">
                  <DoorOpen className="h-3.5 w-3.5" />
                  <span>
                    Action: Open exterior windows or relocate to another room
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss warning banner"
              className="rounded-lg p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Secondary Environmental Telemetry Sensors */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-zinc-900 text-xs text-zinc-400">
        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-zinc-900/40">
          <Thermometer className="h-3.5 w-3.5 text-orange-400" />
          <div>
            <div className="text-[10px] text-zinc-500">Temp</div>
            <div className="font-mono text-zinc-200">
              {temperatureC !== undefined ? `${temperatureC}°C` : "22.4°C"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-zinc-900/40">
          <Droplets className="h-3.5 w-3.5 text-blue-400" />
          <div>
            <div className="text-[10px] text-zinc-500">Humidity</div>
            <div className="font-mono text-zinc-200">
              {humidityPercent !== undefined ? `${humidityPercent}%` : "48%"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-zinc-900/40">
          <Activity className="h-3.5 w-3.5 text-purple-400" />
          <div>
            <div className="text-[10px] text-zinc-500">TVOC</div>
            <div className="font-mono text-zinc-200">
              {tvocPpb !== undefined ? `${tvocPpb} ppb` : "120 ppb"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-zinc-900/40">
          <Wind className="h-3.5 w-3.5 text-cyan-400" />
          <div>
            <div className="text-[10px] text-zinc-500">PM2.5</div>
            <div className="font-mono text-zinc-200">
              {pm25 !== undefined ? `${pm25} µg/m³` : "4 µg/m³"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
