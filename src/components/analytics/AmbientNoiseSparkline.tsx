"use client";

import React, { useState, useMemo, useRef, useCallback } from "react";

export interface HourlyDecibelPoint {
  hour: number;
  dBA: number;
  /** Optional timestamp in epoch ms or ISO string for sub-hourly rolling windows */
  timestamp?: number | string;
}

export type VenueAcousticType = "quiet" | "lively";

export interface AmbientNoiseSparklineProps {
  hourlyDecibels?: HourlyDecibelPoint[];
  /** Optional decibel threshold (defaults to 65 dB for quiet venues, 75 dB for lively spaces) */
  thresholdDb?: number;
  /** Venue acoustic profile used when thresholdDb is omitted (default: "quiet" -> 65 dB) */
  venueType?: VenueAcousticType;
  width?: number;
  height?: number;
  className?: string;
  strokeWidth?: number;
  showPoints?: boolean;
  showArea?: boolean;
  showGrid?: boolean;
  title?: string;
  testId?: string;
}

export const DEFAULT_QUIET_THRESHOLD_DB = 65;
export const DEFAULT_LIVELY_THRESHOLD_DB = 75;
export const ROLLING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Default 24-hour ambient noise telemetry profile (in dBA).
 */
export const DEFAULT_HOURLY_DECIBELS: HourlyDecibelPoint[] = [
  { hour: 0, dBA: 36 },
  { hour: 1, dBA: 35 },
  { hour: 2, dBA: 34 },
  { hour: 3, dBA: 34 },
  { hour: 4, dBA: 36 },
  { hour: 5, dBA: 38 },
  { hour: 6, dBA: 42 },
  { hour: 7, dBA: 48 },
  { hour: 8, dBA: 56 },
  { hour: 9, dBA: 62 },
  { hour: 10, dBA: 64 },
  { hour: 11, dBA: 67 },
  { hour: 12, dBA: 71 }, // Lunch peak
  { hour: 13, dBA: 69 },
  { hour: 14, dBA: 61 },
  { hour: 15, dBA: 58 },
  { hour: 16, dBA: 63 },
  { hour: 17, dBA: 66 },
  { hour: 18, dBA: 68 },
  { hour: 19, dBA: 62 },
  { hour: 20, dBA: 53 },
  { hour: 21, dBA: 47 },
  { hour: 22, dBA: 41 },
  { hour: 23, dBA: 38 },
];

/**
 * Formats a 24-hour index into standard clock time (e.g. 14 -> "2:00 PM").
 */
export function formatHour(hour: number): string {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:00 ${period}`;
}

/**
 * Returns acoustic vibe category and color for a given dBA reading:
 *  - Green (<45 dBA): Quiet Focus
 *  - Yellow (45-65 dBA): Moderate Buzz
 *  - Red (>65 dBA): Lively / Loud
 */
export function getNoiseLevelCategory(dba: number): {
  label: string;
  color: string;
  badgeBg: string;
} {
  if (dba < 45) {
    return {
      label: "Quiet Focus",
      color: "text-emerald-400",
      badgeBg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    };
  }
  if (dba <= 65) {
    return {
      label: "Moderate Buzz",
      color: "text-amber-400",
      badgeBg: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    };
  }
  return {
    label: "Lively / Loud",
    color: "text-rose-400",
    badgeBg: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  };
}

/**
 * Computes the current rolling 5-minute average decibel level from the telemetry series,
 * along with the peak spike and total duration exceeding `thresholdDb`.
 */
export function computeNoiseThresholdStats(
  series: HourlyDecibelPoint[],
  thresholdDb: number,
): {
  rollingAverageDb: number;
  peakDb: number;
  exceededDurationMinutes: number;
  exceededDurationLabel: string;
} {
  if (!series || series.length === 0) {
    return {
      rollingAverageDb: 0,
      peakDb: 0,
      exceededDurationMinutes: 0,
      exceededDurationLabel: "0 min",
    };
  }

  const parsedTimestamps = series.map((pt) => {
    if (typeof pt.timestamp === "number") return pt.timestamp;
    if (typeof pt.timestamp === "string") {
      const parsed = Date.parse(pt.timestamp);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  });

  const hasTimestamps = parsedTimestamps.every((ts) => ts !== null);
  let windowPoints: HourlyDecibelPoint[] = [];

  if (hasTimestamps) {
    const latestTs = parsedTimestamps[parsedTimestamps.length - 1] as number;
    const cutoffTs = latestTs - ROLLING_WINDOW_MS;
    windowPoints = series.filter((_, idx) => {
      const ts = parsedTimestamps[idx] as number;
      return ts >= cutoffTs && ts <= latestTs;
    });
  } else {
    // For discrete telemetry samples without explicit timestamps,
    // use the latest sample as the current 5-minute window reading.
    windowPoints = [series[series.length - 1]];
  }

  const sum = windowPoints.reduce((acc, pt) => acc + pt.dBA, 0);
  const rollingAverageDb = Math.round(sum / Math.max(1, windowPoints.length));

  let peakDb = -Infinity;
  let exceededDurationMinutes = 0;

  if (hasTimestamps) {
    for (let i = 0; i < series.length; i++) {
      if (series[i].dBA > peakDb) peakDb = series[i].dBA;
      if (series[i].dBA > thresholdDb) {
        const currentTs = parsedTimestamps[i] as number;
        const prevTs =
          i > 0
            ? (parsedTimestamps[i - 1] as number)
            : currentTs - ROLLING_WINDOW_MS;
        const deltaMin = Math.max(1, Math.round((currentTs - prevTs) / 60_000));
        exceededDurationMinutes += deltaMin;
      }
    }
  } else {
    // Hourly telemetry series: each sample represents a 60-minute interval
    for (const pt of series) {
      if (pt.dBA > peakDb) peakDb = pt.dBA;
      if (pt.dBA > thresholdDb) {
        exceededDurationMinutes += 60;
      }
    }
  }

  const exceededDurationLabel =
    exceededDurationMinutes >= 60
      ? `${(exceededDurationMinutes / 60).toFixed(exceededDurationMinutes % 60 === 0 ? 0 : 1)} hr`
      : `${exceededDurationMinutes} min`;

  return {
    rollingAverageDb,
    peakDb: Number.isFinite(peakDb) ? peakDb : 0,
    exceededDurationMinutes,
    exceededDurationLabel,
  };
}

/**
 * Generates a smooth cubic Bézier curve SVG path (M... C...) connecting a list of 2D points.
 */
export function generateCubicBezierPath(
  points: Array<{ x: number; y: number }>,
): string {
  if (!points || points.length === 0) return "";
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;

    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }

  return d;
}

export function AmbientNoiseSparkline({
  hourlyDecibels = DEFAULT_HOURLY_DECIBELS,
  thresholdDb,
  venueType = "quiet",
  width = 340,
  height = 100,
  className = "",
  strokeWidth = 2.5,
  showPoints = true,
  showArea = true,
  showGrid = true,
  title = "Ambient Noise (24h Acoustic Profile)",
  testId = "ambient-noise-sparkline",
}: AmbientNoiseSparklineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [showAlertTooltip, setShowAlertTooltip] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const effectiveThresholdDb =
    typeof thresholdDb === "number" && Number.isFinite(thresholdDb)
      ? thresholdDb
      : venueType === "lively"
        ? DEFAULT_LIVELY_THRESHOLD_DB
        : DEFAULT_QUIET_THRESHOLD_DB;

  const { rollingAverageDb, peakDb, exceededDurationLabel } = useMemo(
    () => computeNoiseThresholdStats(hourlyDecibels, effectiveThresholdDb),
    [hourlyDecibels, effectiveThresholdDb],
  );

  const isExceedingThreshold = rollingAverageDb > effectiveThresholdDb;
  const isSevereNoise = rollingAverageDb > effectiveThresholdDb + 10;

  // SVG viewport padding
  const padding = { top: 12, bottom: 20, left: 16, right: 16 };
  const innerWidth = Math.max(10, width - padding.left - padding.right);
  const innerHeight = Math.max(10, height - padding.top - padding.bottom);

  const minDba = 30;
  const maxDba = Math.max(85, effectiveThresholdDb + 10);
  const dbaRange = maxDba - minDba;

  // Compute Y coordinate for the dashed threshold line
  const clampedThreshold = Math.max(
    minDba,
    Math.min(maxDba, effectiveThresholdDb),
  );
  const thresholdY =
    padding.top +
    innerHeight -
    ((clampedThreshold - minDba) / dbaRange) * innerHeight;

  // Map input data points to SVG coordinate space
  const mappedPoints = useMemo(() => {
    if (!hourlyDecibels || hourlyDecibels.length === 0) return [];
    return hourlyDecibels.map((item, index) => {
      const x =
        padding.left +
        (index / Math.max(1, hourlyDecibels.length - 1)) * innerWidth;
      const clampedDba = Math.max(minDba, Math.min(maxDba, item.dBA));
      const y =
        padding.top +
        innerHeight -
        ((clampedDba - minDba) / dbaRange) * innerHeight;
      return {
        x,
        y,
        hour: item.hour,
        dBA: item.dBA,
        index,
      };
    });
  }, [
    hourlyDecibels,
    innerWidth,
    innerHeight,
    padding.left,
    padding.top,
    dbaRange,
    maxDba,
  ]);

  const strokePath = useMemo(
    () => generateCubicBezierPath(mappedPoints),
    [mappedPoints],
  );

  const areaPath = useMemo(() => {
    if (mappedPoints.length < 2) return "";
    const baselineY = padding.top + innerHeight;
    const firstPoint = mappedPoints[0];
    const lastPoint = mappedPoints[mappedPoints.length - 1];
    return `${strokePath} L ${lastPoint.x.toFixed(1)} ${baselineY} L ${firstPoint.x.toFixed(1)} ${baselineY} Z`;
  }, [strokePath, mappedPoints, padding.top, innerHeight]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (mappedPoints.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const relativeX = ((e.clientX - rect.left) / rect.width) * width;

      let closestIdx = 0;
      let minDistance = Infinity;
      mappedPoints.forEach((p, idx) => {
        const dist = Math.abs(p.x - relativeX);
        if (dist < minDistance) {
          minDistance = dist;
          closestIdx = idx;
        }
      });
      setHoveredIndex(closestIdx);
    },
    [mappedPoints, width],
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  const activePoint =
    hoveredIndex !== null && mappedPoints[hoveredIndex]
      ? mappedPoints[hoveredIndex]
      : null;

  const activeCategory = activePoint
    ? getNoiseLevelCategory(activePoint.dBA)
    : null;

  const alertAriaLabel = `High noise alert: current 5-minute average is ${rollingAverageDb} dB, exceeding the ${effectiveThresholdDb} dB threshold. Peak spike reached ${peakDb} dB for ${exceededDurationLabel}.`;

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className={`relative flex flex-col p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800 text-zinc-100 select-none ${className}`}
    >
      {/* Title & Stats Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-1 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full animate-pulse ${
              isExceedingThreshold ? "bg-rose-500" : "bg-emerald-400"
            }`}
          />
          <h4
            data-testid="sparkline-title"
            className="text-xs font-bold font-mono tracking-wide text-zinc-200 uppercase"
          >
            {title}
          </h4>
          <span
            data-testid="current-db-reading"
            className="text-xs font-mono font-semibold text-zinc-300"
          >
            {rollingAverageDb} dB
          </span>
        </div>

        {/* Dynamic Decibel Threshold Alert Badge */}
        {isExceedingThreshold ? (
          <div
            className="relative"
            onMouseEnter={() => setShowAlertTooltip(true)}
            onMouseLeave={() => setShowAlertTooltip(false)}
          >
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {`Ambient noise threshold exceeded. ${alertAriaLabel}`}
            </span>
            <button
              type="button"
              data-testid="noise-threshold-alert-badge"
              aria-label={alertAriaLabel}
              aria-describedby="noise-threshold-alert-tooltip"
              onFocus={() => setShowAlertTooltip(true)}
              onBlur={() => setShowAlertTooltip(false)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/60 ${
                isSevereNoise
                  ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/40"
              }`}
            >
              <span aria-hidden="true">⚠️</span>
              <span>High Noise Level: {rollingAverageDb} dB</span>
            </button>

            {showAlertTooltip && (
              <div
                id="noise-threshold-alert-tooltip"
                data-testid="noise-threshold-alert-tooltip"
                role="tooltip"
                className="absolute right-0 top-full mt-1.5 z-30 w-56 p-2.5 rounded-xl bg-zinc-900/95 border border-zinc-700 shadow-xl backdrop-blur-md text-[11px] font-mono text-zinc-200 flex flex-col gap-1"
              >
                <div className="flex justify-between">
                  <span className="text-zinc-400">Threshold:</span>
                  <span className="font-semibold text-amber-300">
                    {effectiveThresholdDb} dB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Peak Spike:</span>
                  <span className="font-semibold text-rose-400">
                    {peakDb} dB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Exceeded For:</span>
                  <span className="font-semibold text-zinc-100">
                    {exceededDurationLabel}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              &lt;45 dB
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              45-65 dB
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              &gt;65 dB
            </span>
          </div>
        )}
      </div>

      {/* Interactive SVG Sparkline Canvas */}
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible cursor-crosshair touch-none"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          data-testid="ambient-noise-svg"
        >
          <defs>
            <linearGradient
              id="noiseLevelGradient"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="30%" stopColor="#ef4444" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="75%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>

            <linearGradient
              id="noiseAreaGradient"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
              <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Optional horizontal guideline grid */}
          {showGrid && (
            <g className="opacity-20" aria-hidden="true">
              <line
                x1={padding.left}
                y1={
                  padding.top +
                  innerHeight -
                  ((65 - minDba) / dbaRange) * innerHeight
                }
                x2={width - padding.right}
                y2={
                  padding.top +
                  innerHeight -
                  ((65 - minDba) / dbaRange) * innerHeight
                }
                stroke="#ef4444"
                strokeDasharray="2 3"
                strokeWidth="0.8"
              />
              <line
                x1={padding.left}
                y1={
                  padding.top +
                  innerHeight -
                  ((45 - minDba) / dbaRange) * innerHeight
                }
                x2={width - padding.right}
                y2={
                  padding.top +
                  innerHeight -
                  ((45 - minDba) / dbaRange) * innerHeight
                }
                stroke="#10b981"
                strokeDasharray="2 3"
                strokeWidth="0.8"
              />
            </g>
          )}

          {/* Dashed Horizontal Threshold Line at thresholdDb Y-axis value */}
          <g data-testid="noise-threshold-line-group">
            <line
              data-testid="noise-threshold-line"
              x1={padding.left}
              y1={thresholdY}
              x2={width - padding.right}
              y2={thresholdY}
              stroke={isExceedingThreshold ? "#f59e0b" : "#a1a1aa"}
              strokeDasharray="4 3"
              strokeWidth="1.2"
              opacity={isExceedingThreshold ? 0.9 : 0.55}
              aria-label={`Noise threshold line at ${effectiveThresholdDb} dB`}
            />
            <text
              data-testid="noise-threshold-label"
              x={width - padding.right}
              y={Math.max(padding.top + 6, thresholdY - 3)}
              textAnchor="end"
              fill={isExceedingThreshold ? "#fbbf24" : "#a1a1aa"}
              fontSize="8"
              fontFamily="monospace"
            >
              {effectiveThresholdDb} dB
            </text>
          </g>

          {/* Area under Bézier curve */}
          {showArea && areaPath && (
            <path
              d={areaPath}
              fill="url(#noiseAreaGradient)"
              data-testid="sparkline-area-path"
            />
          )}

          {/* Smooth Cubic Bézier Curve Stroke */}
          {strokePath && (
            <path
              d={strokePath}
              fill="none"
              stroke="url(#noiseLevelGradient)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              data-testid="sparkline-bezier-path"
            />
          )}

          {/* Active Hover Crosshair Line and Pulse Point */}
          {activePoint && (
            <g aria-hidden="true" data-testid="sparkline-hover-indicator">
              <line
                x1={activePoint.x}
                y1={padding.top}
                x2={activePoint.x}
                y2={padding.top + innerHeight}
                stroke="#e4e4e7"
                strokeWidth="1"
                strokeDasharray="3 2"
                opacity="0.6"
              />

              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="6"
                fill="none"
                stroke="url(#noiseLevelGradient)"
                strokeWidth="2"
                className="animate-ping origin-center"
              />

              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="4"
                fill="#ffffff"
                stroke="url(#noiseLevelGradient)"
                strokeWidth="2"
              />
            </g>
          )}

          {/* Optional Data Point Markers */}
          {showPoints &&
            mappedPoints.map((p) => (
              <circle
                key={p.index}
                cx={p.x}
                cy={p.y}
                r={hoveredIndex === p.index ? 4.5 : 2}
                fill={
                  hoveredIndex === p.index
                    ? "#ffffff"
                    : "url(#noiseLevelGradient)"
                }
                className="transition-all duration-150"
                aria-hidden="true"
              />
            ))}
        </svg>

        {/* Interactive Floating Hover Tooltip */}
        {activePoint && activeCategory && (
          <div
            data-testid="sparkline-tooltip"
            role="tooltip"
            aria-live="polite"
            data-hour={activePoint.hour}
            data-dba={activePoint.dBA}
            className="absolute z-20 pointer-events-none transform -translate-x-1/2 px-2.5 py-1.5 rounded-xl bg-zinc-900/95 border border-zinc-700 shadow-xl backdrop-blur-md text-xs font-mono flex flex-col items-center gap-0.5 animate-in fade-in zoom-in-95 duration-150"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: `${Math.max(2, (activePoint.y / height) * 100 - 45)}%`,
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-zinc-300">
                {formatHour(activePoint.hour)}
              </span>
              <span className="text-zinc-600 dark:text-zinc-500">·</span>
              <span className="font-bold text-white text-sm">
                {activePoint.dBA}
                <span className="text-[10px] text-zinc-400 font-normal ml-0.5">
                  dBA
                </span>
              </span>
            </div>
            <span
              className={`px-1.5 py-0.2 rounded-md text-[9px] uppercase font-bold border ${activeCategory.badgeBg}`}
            >
              {activeCategory.label}
            </span>
          </div>
        )}
      </div>

      {/* Axis Hour Labels Footer */}
      <div className="flex justify-between items-center pt-1.5 text-[10px] font-mono text-zinc-500">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>11 PM</span>
      </div>
    </div>
  );
}

export default AmbientNoiseSparkline;
