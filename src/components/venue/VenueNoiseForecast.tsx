"use client";

import React, { useEffect, useState, useId } from "react";
import { Loader2, Volume2, ShieldAlert, Sparkles, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HourlyForecast, NoiseForecastResult } from "@/lib/noiseForecast";

export interface VenueNoiseForecastProps {
  venueId: string;
  venueName?: string;
  timeZone?: string;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  className?: string;
}

export type NoiseClassification = "Quiet" | "Moderate" | "Loud" | "No Data";

export interface ProcessedNoiseSlot {
  hour: number;
  timeLabel: string;
  predictedDb: number | null;
  confidence: number;
  samples: number;
  isHistorical: boolean;
  classification: NoiseClassification;
  colorClass: string;
  fillHex: string;
}

export function classifyNoise(db: number | null): NoiseClassification {
  if (db === null || !Number.isFinite(db)) return "No Data";
  if (db < 50) return "Quiet";
  if (db <= 65) return "Moderate";
  return "Loud";
}

export function getNoiseColor(classification: NoiseClassification): {
  colorClass: string;
  fillHex: string;
} {
  switch (classification) {
    case "Quiet":
      return {
        colorClass: "bg-emerald-500 text-emerald-700 dark:text-emerald-400 border-emerald-500",
        fillHex: "#10b981",
      };
    case "Moderate":
      return {
        colorClass: "bg-amber-500 text-amber-700 dark:text-amber-400 border-amber-500",
        fillHex: "#f59e0b",
      };
    case "Loud":
      return {
        colorClass: "bg-rose-500 text-rose-700 dark:text-rose-400 border-rose-500",
        fillHex: "#f43f5e",
      };
    default:
      return {
        colorClass: "bg-zinc-300 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 border-zinc-400",
        fillHex: "#71717a",
      };
  }
}

export function VenueNoiseForecast({
  venueId,
  venueName,
  timeZone,
  quietHoursStart,
  quietHoursEnd,
  className,
}: VenueNoiseForecastProps) {
  const [data, setData] = useState<NoiseForecastResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [focusedHour, setFocusedHour] = useState<number | null>(null);

  const patternId = useId();

  // Determine current hour and minute for the current-time indicator line
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTimeProgress = currentHour + currentMinute / 60; // 0.00 to 23.99

  useEffect(() => {
    let isCancelled = false;
    const resolvedTz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    async function fetchForecast() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/venues/${encodeURIComponent(venueId)}/noise-metrics/forecast?tz=${encodeURIComponent(resolvedTz)}`,
        );
        if (!res.ok) {
          throw new Error(`Failed to load forecast (${res.status})`);
        }
        const json = await res.json();
        if (!isCancelled) {
          setData(json?.forecast ? json.forecast : json);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "Error loading forecast");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchForecast();

    return () => {
      isCancelled = true;
    };
  }, [venueId, timeZone]);

  if (isLoading) {
    return (
      <div
        data-testid="venue-noise-forecast-loading"
        className={cn(
          "w-full h-64 flex flex-col items-center justify-center gap-2 bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6",
          className,
        )}
      >
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        <span className="text-xs text-zinc-500 font-medium">Loading 24-hour noise forecast...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        data-testid="venue-noise-forecast-error"
        className={cn(
          "w-full p-6 text-center bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200 dark:border-zinc-800",
          className,
        )}
      >
        <div className="flex items-center justify-center gap-2 text-rose-500 mb-1">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm font-semibold">Forecast Unavailable</span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {error || "Could not retrieve ambient noise telemetry."}
        </p>
      </div>
    );
  }

  // Build full 24 slots (00:00 to 23:00)
  const rawList: HourlyForecast[] = Array.isArray(data.forecast) ? data.forecast : [];
  const mapByHour = new Map<number, HourlyForecast>();
  for (const item of rawList) {
    if (typeof item.hour === "number" && item.hour >= 0 && item.hour < 24) {
      mapByHour.set(item.hour, item);
    }
  }

  const slots: ProcessedNoiseSlot[] = [];
  let hasValidTelemetry = false;

  for (let h = 0; h < 24; h++) {
    const raw = mapByHour.get(h);
    const predictedDb = raw && typeof raw.predictedDb === "number" && Number.isFinite(raw.predictedDb)
      ? Math.round(raw.predictedDb * 10) / 10
      : null;
    const confidence = raw?.confidence ?? 0;
    const samples = raw?.samples ?? 0;

    if (predictedDb !== null) {
      hasValidTelemetry = true;
    }

    const classification = classifyNoise(predictedDb);
    const { colorClass, fillHex } = getNoiseColor(classification);

    // Distinguish historical measurements from predicted values:
    // When historical samples exist and hour is past/current, it's measured; otherwise predicted
    const isHistorical = samples > 0 && h <= currentHour;

    slots.push({
      hour: h,
      timeLabel: `${h.toString().padStart(2, "0")}:00`,
      predictedDb,
      confidence,
      samples,
      isHistorical,
      classification,
      colorClass,
      fillHex,
    });
  }

  if (!hasValidTelemetry) {
    return (
      <div
        data-testid="venue-noise-forecast-empty"
        className={cn(
          "w-full p-6 text-center bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200 dark:border-zinc-800",
          className,
        )}
      >
        <Volume2 className="w-6 h-6 text-zinc-400 mx-auto mb-2" />
        <h4 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">No Historical Telemetry</h4>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Ambient sound readings have not yet been recorded for {venueName || "this venue"}.
        </p>
      </div>
    );
  }

  // Quiet hours banner logic:
  // Render if quietHoursStart & quietHoursEnd exist, OR if API provides recommendedHours
  const hasConfiguredQuietHours = Boolean(quietHoursStart && quietHoursEnd);
  const recommendedHours = Array.isArray(data.recommendedHours) ? data.recommendedHours : [];
  const showQuietHoursBanner = hasConfiguredQuietHours || recommendedHours.length > 0;

  const quietHoursLabel = hasConfiguredQuietHours
    ? `${quietHoursStart} – ${quietHoursEnd}`
    : recommendedHours
        .sort((a, b) => a - b)
        .map((h) => `${h.toString().padStart(2, "0")}:00`)
        .join(", ");

  const activeSlotIndex = focusedHour !== null ? focusedHour : hoveredHour;
  const activeSlot = activeSlotIndex !== null ? slots[activeSlotIndex] : null;

  // Chart dimensions & scaling
  const chartHeight = 160;
  const chartWidth = 720;
  const paddingLeft = 36;
  const paddingRight = 14;
  const paddingTop = 16;
  const paddingBottom = 28;

  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  const barWidth = Math.max(4, plotWidth / 24 - 4);
  const minDb = 30;
  const maxDb = 90;

  // X coordinate calculation for hour index (0..23)
  const getXForHour = (hour: number) => {
    return paddingLeft + (hour / 24) * plotWidth + (plotWidth / 24) / 2;
  };

  // Y coordinate calculation for dB value
  const getYForDb = (db: number) => {
    const clamped = Math.max(minDb, Math.min(maxDb, db));
    const ratio = (clamped - minDb) / (maxDb - minDb);
    return paddingTop + plotHeight - ratio * plotHeight;
  };

  // Current time line X position
  const currentTimeX = paddingLeft + (currentTimeProgress / 24) * plotWidth;

  return (
    <div
      data-testid="venue-noise-forecast"
      className={cn(
        "w-full bg-white dark:bg-zinc-900 rounded-3xl p-5 sm:p-6 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4",
        className,
      )}
      aria-label="24-hour ambient noise forecast"
    >
      {/* Header with Title and Current Noise Level if known */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Volume2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black tracking-tight text-zinc-900 dark:text-zinc-100 uppercase">
              24-Hour Ambient Noise Forecast
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
              Real-time acoustics and predictive SPL telemetry
            </p>
          </div>
        </div>

        {/* Current status pill */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
          <Clock className="w-3.5 h-3.5 text-zinc-400" />
          <span>Current: {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
        </div>
      </div>

      {/* Quiet Hours Banner */}
      {showQuietHoursBanner && (
        <div
          data-testid="quiet-hours-banner"
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 text-xs text-emerald-800 dark:text-emerald-300"
        >
          <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-bold">Designated Quiet Hours:</span>
            <span className="font-mono bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded text-[11px] font-semibold">
              {quietHoursLabel}
            </span>
            <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">
              (Ideal for focused study & calls)
            </span>
          </div>
        </div>
      )}

      {/* Active Selection / Tooltip Display Card */}
      <div
        data-testid="noise-forecast-tooltip"
        className="min-h-[52px] flex items-center justify-between p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 text-xs transition-all"
        aria-live="polite"
      >
        {activeSlot ? (
          <div className="w-full flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-black text-sm text-zinc-900 dark:text-zinc-100 font-mono">
                {activeSlot.timeLabel} - {((activeSlot.hour + 1) % 24).toString().padStart(2, "0")}:00
              </span>
              <span
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  activeSlot.classification === "Quiet" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                  activeSlot.classification === "Moderate" && "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                  activeSlot.classification === "Loud" && "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
                  activeSlot.classification === "No Data" && "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
                )}
              >
                {activeSlot.classification}
              </span>
              <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                ({activeSlot.isHistorical ? "Historical Measurement" : "Model Predicted"})
              </span>
            </div>

            <div className="flex items-center gap-3">
              {activeSlot.predictedDb !== null ? (
                <span className="font-extrabold text-sm text-zinc-900 dark:text-zinc-100">
                  {activeSlot.predictedDb} <span className="text-xs font-normal text-zinc-500">dB SPL</span>
                </span>
              ) : (
                <span className="text-zinc-400 italic">No telemetry recorded</span>
              )}
              {activeSlot.samples > 0 && (
                <span className="text-[10px] text-zinc-400">
                  {activeSlot.samples} {activeSlot.samples === 1 ? "sample" : "samples"}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-zinc-400">
            <Clock className="w-3.5 h-3.5" />
            <span className="text-xs">Hover or use arrow keys on bars to view hourly decibel sound levels.</span>
          </div>
        )}
      </div>

      {/* SVG 24-Hour Bar Chart */}
      <div className="w-full overflow-hidden">
        <svg
          role="figure"
          aria-label="24-hour ambient noise decibel forecast chart"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-auto max-h-56 select-none"
        >
          <defs>
            {/* Pattern for predicted values */}
            <pattern
              id={`predicted-stripes-${patternId}`}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
            </pattern>
          </defs>

          {/* Reference threshold grid lines & y-axis labels */}
          {[
            { db: 30, label: "30 dB" },
            { db: 50, label: "50 dB (Quiet)" },
            { db: 65, label: "65 dB (Mod)" },
            { db: 85, label: "85 dB (Loud)" },
          ].map(({ db, label }) => {
            const y = getYForDb(db);
            return (
              <g key={db}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800"
                  strokeDasharray={db === 50 || db === 65 ? "4 4" : undefined}
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="8"
                  className="fill-zinc-400 dark:fill-zinc-500 font-mono"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* Hourly Bars */}
          {slots.map((slot) => {
            const barX = getXForHour(slot.hour) - barWidth / 2;
            const db = slot.predictedDb ?? minDb;
            const barY = getYForDb(db);
            const rawHeight = paddingTop + plotHeight - barY;
            const barHeight = slot.predictedDb !== null ? Math.max(4, rawHeight) : 3;
            const isSelected = activeSlotIndex === slot.hour;

            const ariaLabelText = `${slot.timeLabel}: ${
              slot.predictedDb !== null ? `${slot.predictedDb} dB SPL` : "No data"
            }, ${slot.classification}, ${slot.isHistorical ? "historical" : "predicted"}`;

            return (
              <g
                key={slot.hour}
                tabIndex={0}
                role="button"
                aria-label={ariaLabelText}
                data-testid={`noise-bar-${slot.hour}`}
                className="cursor-pointer focus:outline-none"
                onMouseEnter={() => setHoveredHour(slot.hour)}
                onMouseLeave={() => setHoveredHour(null)}
                onFocus={() => setFocusedHour(slot.hour)}
                onBlur={() => setFocusedHour(null)}
                onClick={() => setHoveredHour(slot.hour)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") {
                    e.preventDefault();
                    setFocusedHour((prev) => (prev === null ? 0 : (prev + 1) % 24));
                  } else if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    setFocusedHour((prev) => (prev === null ? 23 : (prev - 1 + 24) % 24));
                  }
                }}
              >
                {/* Background hover/focus column target */}
                <rect
                  x={paddingLeft + (slot.hour / 24) * plotWidth}
                  y={paddingTop}
                  width={plotWidth / 24}
                  height={plotHeight}
                  fill="transparent"
                  className={cn(
                    "transition-colors",
                    isSelected ? "fill-zinc-100/50 dark:fill-zinc-800/40" : "",
                  )}
                />

                {/* The main noise bar */}
                <rect
                  x={barX}
                  y={slot.predictedDb !== null ? barY : paddingTop + plotHeight - 3}
                  width={barWidth}
                  height={barHeight}
                  rx="3"
                  ry="3"
                  fill={slot.fillHex}
                  opacity={slot.isHistorical ? 0.95 : 0.75}
                  stroke={isSelected ? "#3b82f6" : "none"}
                  strokeWidth={isSelected ? "2" : "0"}
                  className="transition-all duration-200"
                />

                {/* Striped overlay for predicted bars */}
                {!slot.isHistorical && slot.predictedDb !== null && (
                  <rect
                    x={barX}
                    y={barY}
                    width={barWidth}
                    height={barHeight}
                    rx="3"
                    ry="3"
                    fill={`url(#predicted-stripes-${patternId})`}
                    opacity={0.35}
                    pointerEvents="none"
                  />
                )}

                {/* X-axis labels at key intervals: 00:00, 06:00, 12:00, 18:00, 23:00 */}
                {(slot.hour === 0 || slot.hour === 6 || slot.hour === 12 || slot.hour === 18 || slot.hour === 23) && (
                  <text
                    x={getXForHour(slot.hour)}
                    y={chartHeight - 8}
                    textAnchor="middle"
                    fontSize="9"
                    className="fill-zinc-500 dark:fill-zinc-400 font-mono font-medium"
                  >
                    {slot.timeLabel}
                  </text>
                )}
              </g>
            );
          })}

          {/* Current-time vertical indicator line */}
          <g data-testid="current-time-indicator" pointerEvents="none">
            <line
              x1={currentTimeX}
              y1={paddingTop - 6}
              x2={currentTimeX}
              y2={paddingTop + plotHeight + 2}
              stroke="#ef4444"
              strokeWidth="2"
              strokeDasharray="3 3"
            />
            {/* Small top beacon */}
            <circle cx={currentTimeX} cy={paddingTop - 6} r="3" fill="#ef4444" />
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div
        data-testid="noise-forecast-legend"
        className="flex flex-wrap items-center justify-between gap-y-2 gap-x-4 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400"
      >
        {/* Classification labels */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <span>Quiet (&lt;50 dB)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
            <span>Moderate (50–65 dB)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
            <span>Loud (&gt;65 dB)</span>
          </div>
        </div>

        {/* Status indicator labels */}
        <div className="flex items-center gap-3 font-medium">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded bg-zinc-600 dark:bg-zinc-400 opacity-95 shrink-0" />
            <span>Historical</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded border border-dashed border-zinc-500 bg-zinc-400/40 shrink-0" />
            <span>Predicted</span>
          </div>
          <div className="flex items-center gap-1.5 text-rose-500 font-semibold">
            <span className="w-2.5 h-0.5 bg-rose-500 shrink-0" />
            <span>Current Time</span>
          </div>
        </div>
      </div>
    </div>
  );
}
