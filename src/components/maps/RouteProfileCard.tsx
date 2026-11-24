"use client";

import React, { useMemo, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  XCircle,
  Footprints,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RouteProfileEvaluation,
  ElevationProfilePoint,
  AccessibilityStatus,
} from "@/lib/routing/elevation";

export interface RouteProfileCardProps {
  /** Evaluated route profile containing distance, elevation gains, incline, and accessibility status */
  evaluation: RouteProfileEvaluation;
  /** Optional title for the route (e.g. "Transit Station to Venue") */
  title?: string;
  /** Optional extra CSS class names */
  className?: string;
  /** Whether the card starts in expanded mode (defaults to true) */
  defaultExpanded?: boolean;
  /** Callback when an elevation point is hovered on the mini SVG chart */
  onPointHover?: (point: ElevationProfilePoint | null) => void;
  /** Custom test ID */
  "data-testid"?: string;
}

/**
 * RouteProfileCard Component
 *
 * Displays an elevation gain summary, incline metrics, wheelchair accessibility warnings,
 * and a responsive mini SVG elevation profile chart for pedestrian routes connecting transit
 * stations to co-working venues.
 *
 * Issue #9757: feat(routing): add elevation gain and wheelchair-accessible route profile summary on map
 */
export function RouteProfileCard({
  evaluation,
  title = "Route Elevation & Accessibility",
  className,
  defaultExpanded = true,
  onPointHover,
  "data-testid": testId = "route-profile-card",
}: RouteProfileCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  const {
    hasElevationData,
    totalDistanceMeters,
    totalAscentMeters,
    totalDescentMeters,
    minElevationMeters,
    maxElevationMeters,
    profilePoints,
    incline,
    accessibility,
  } = evaluation;

  // Chart coordinate mapping calculations
  const chartData = useMemo(() => {
    if (!hasElevationData || profilePoints.length < 2) {
      return null;
    }

    const width = 300;
    const height = 90;
    const paddingX = 12;
    const paddingTop = 12;
    const paddingBottom = 20;

    const plotWidth = width - paddingX * 2;
    const plotHeight = height - paddingTop - paddingBottom;

    const minEle = minElevationMeters ?? 0;
    const maxEle = maxElevationMeters ?? 10;
    const eleSpan = Math.max(1, maxEle - minEle);

    const maxDist = Math.max(1, totalDistanceMeters);

    const points = profilePoints.map((pt) => {
      const x = paddingX + (pt.distanceFromStartMeters / maxDist) * plotWidth;
      const y = paddingTop + plotHeight - ((pt.elevationMeters - minEle) / eleSpan) * plotHeight;
      return { x, y, pt };
    });

    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(paddingTop + plotHeight).toFixed(1)} L ${points[0].x.toFixed(1)} ${(paddingTop + plotHeight).toFixed(1)} Z`;

    // Steep segments (> 8.0%) overlay lines
    const steepSegments: { x1: number; y1: number; x2: number; y2: number; isWheelchairLimit: boolean }[] = [];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (curr.pt.isSteepWarning) {
        steepSegments.push({
          x1: prev.x,
          y1: prev.y,
          x2: curr.x,
          y2: curr.y,
          isWheelchairLimit: curr.pt.isWheelchairInaccessibleSlope,
        });
      }
    }

    return {
      width,
      height,
      points,
      linePath,
      areaPath,
      steepSegments,
      minEle,
      maxEle,
      baselineY: paddingTop + plotHeight,
    };
  }, [hasElevationData, profilePoints, minElevationMeters, maxElevationMeters, totalDistanceMeters]);

  // Accessibility badge config
  const badgeConfig = useMemo(() => {
    const status: AccessibilityStatus = accessibility.status;
    switch (status) {
      case "accessible":
        return {
          label: "Wheelchair Accessible Slope",
          bgClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
          icon: CheckCircle2,
          testId: "accessibility-badge-accessible",
        };
      case "warning":
        return {
          label: "Steep Incline Warning (>8%)",
          bgClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
          icon: AlertTriangle,
          testId: "accessibility-badge-warning",
        };
      case "inaccessible":
        return {
          label: incline.exceedsWheelchairInclineThreshold
            ? "Incline Exceeds Wheelchair Limit (>8.33%)"
            : "Inaccessible (Stairs Detected)",
          bgClass: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
          icon: XCircle,
          testId: "accessibility-badge-inaccessible",
        };
      case "unknown":
      default:
        return {
          label: hasElevationData ? "Accessibility Unconfirmed" : "Elevation & Stairs Unknown",
          bgClass: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
          icon: HelpCircle,
          testId: "accessibility-badge-unknown",
        };
    }
  }, [accessibility.status, incline.exceedsWheelchairInclineThreshold, hasElevationData]);

  const BadgeIcon = badgeConfig.icon;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartData || chartData.points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * chartData.width;

    // Find closest point by x coordinate
    let closestIndex = 0;
    let closestDist = Math.abs(chartData.points[0].x - mouseX);

    for (let i = 1; i < chartData.points.length; i++) {
      const dist = Math.abs(chartData.points[i].x - mouseX);
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    }

    setHoveredPointIndex(closestIndex);
    onPointHover?.(chartData.points[closestIndex].pt);
  };

  const handleMouseLeave = () => {
    setHoveredPointIndex(null);
    onPointHover?.(null);
  };

  const activeHoverPoint =
    hoveredPointIndex !== null && chartData ? chartData.points[hoveredPointIndex] : null;

  return (
    <section
      data-testid={testId}
      aria-label="Route elevation profile and wheelchair accessibility summary"
      className={cn(
        "rounded-xl border bg-card/95 backdrop-blur-md shadow-lg p-3 sm:p-4 text-card-foreground text-xs sm:text-sm max-w-sm w-full transition-all",
        className
      )}
    >
      {/* Header & Accessibility Badge */}
      <header className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-muted-foreground font-medium text-xs mb-1">
            <Footprints className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
            <span className="truncate">{title}</span>
          </div>
          <div
            data-testid={badgeConfig.testId}
            role="status"
            aria-live="polite"
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold border",
              badgeConfig.bgClass
            )}
          >
            <BadgeIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{badgeConfig.label}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse route profile" : "Expand route profile"}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </header>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-3 gap-2 py-1.5 border-y border-border/60 text-center">
        <div>
          <span className="block text-[10px] text-muted-foreground uppercase font-medium">Gain (Ascent)</span>
          <div className="inline-flex items-center gap-0.5 font-bold text-foreground mt-0.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
            <span data-testid="route-elevation-ascent">
              {hasElevationData ? `+${Math.round(totalAscentMeters)}m` : "--"}
            </span>
          </div>
        </div>

        <div>
          <span className="block text-[10px] text-muted-foreground uppercase font-medium">Max Incline</span>
          <div className="inline-flex items-center gap-0.5 font-bold text-foreground mt-0.5">
            <span
              data-testid="route-max-incline"
              className={cn(
                incline.exceedsWheelchairInclineThreshold
                  ? "text-rose-600 dark:text-rose-400"
                  : incline.exceedsSteepWarningThreshold
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-foreground"
              )}
            >
              {hasElevationData ? `${incline.maxUphillGradePercent}%` : "--"}
            </span>
          </div>
        </div>

        <div>
          <span className="block text-[10px] text-muted-foreground uppercase font-medium">Descent</span>
          <div className="inline-flex items-center gap-0.5 font-bold text-foreground mt-0.5">
            <TrendingDown className="w-3.5 h-3.5 text-blue-500" aria-hidden="true" />
            <span data-testid="route-elevation-descent">
              {hasElevationData ? `-${Math.round(totalDescentMeters)}m` : "--"}
            </span>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-3 space-y-2.5 animate-in fade-in-50 duration-200">
          {/* SVG Elevation Chart */}
          {hasElevationData && chartData ? (
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px] text-muted-foreground px-0.5">
                <span>Elevation Profile</span>
                <span>
                  Range: {Math.round(chartData.minEle)}m – {Math.round(chartData.maxEle)}m
                </span>
              </div>

              <div
                data-testid="route-elevation-chart-container"
                className="relative bg-muted/30 rounded-lg p-1 border border-border/50 overflow-hidden"
              >
                <svg
                  viewBox={`0 0 ${chartData.width} ${chartData.height}`}
                  className="w-full h-20 sm:h-24 overflow-visible cursor-crosshair select-none"
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  role="img"
                  aria-label={`Elevation profile chart from 0m to ${Math.round(totalDistanceMeters)}m. Total ascent +${Math.round(totalAscentMeters)}m. Max incline ${incline.maxUphillGradePercent}%.`}
                >
                  <defs>
                    <linearGradient id="elevationAreaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>

                  {/* Shaded Area */}
                  <path d={chartData.areaPath} fill="url(#elevationAreaGradient)" />

                  {/* Profile Line */}
                  <path
                    d={chartData.linePath}
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Steep Segments Highlighting (> 8% or > 8.33%) */}
                  {chartData.steepSegments.map((seg, idx) => (
                    <line
                      key={idx}
                      x1={seg.x1.toFixed(1)}
                      y1={seg.y1.toFixed(1)}
                      x2={seg.x2.toFixed(1)}
                      y2={seg.y2.toFixed(1)}
                      stroke={seg.isWheelchairLimit ? "#f43f5e" : "#f59e0b"}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                  ))}

                  {/* Hover Indicator */}
                  {activeHoverPoint && (
                    <g>
                      <line
                        x1={activeHoverPoint.x}
                        y1={12}
                        x2={activeHoverPoint.x}
                        y2={chartData.baselineY}
                        stroke="currentColor"
                        strokeDasharray="2 2"
                        className="text-muted-foreground/60"
                      />
                      <circle
                        cx={activeHoverPoint.x}
                        cy={activeHoverPoint.y}
                        r="3.5"
                        className={cn(
                          activeHoverPoint.pt.isWheelchairInaccessibleSlope
                            ? "fill-rose-500"
                            : activeHoverPoint.pt.isSteepWarning
                            ? "fill-amber-500"
                            : "fill-primary"
                        )}
                        stroke="#fff"
                        strokeWidth="1.5"
                      />
                    </g>
                  )}
                </svg>

                {/* Scrubber Tooltip */}
                {activeHoverPoint && (
                  <div
                    data-testid="route-chart-scrubber-tooltip"
                    className="absolute bottom-1 right-2 bg-popover/90 text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow border border-border backdrop-blur-sm pointer-events-none"
                  >
                    <span>
                      {Math.round(activeHoverPoint.pt.distanceFromStartMeters)}m:{" "}
                      <strong>{Math.round(activeHoverPoint.pt.elevationMeters)}m</strong>
                      {" • "}
                      <span
                        className={
                          activeHoverPoint.pt.isWheelchairInaccessibleSlope
                            ? "text-rose-500 font-bold"
                            : activeHoverPoint.pt.isSteepWarning
                            ? "text-amber-500 font-semibold"
                            : ""
                        }
                      >
                        {activeHoverPoint.pt.gradePercent}%
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              data-testid="route-elevation-missing-notice"
              className="rounded-lg bg-muted/40 p-2.5 text-center text-muted-foreground text-xs border border-dashed border-border"
            >
              <Info className="w-4 h-4 mx-auto mb-1 text-muted-foreground/70" aria-hidden="true" />
              <span>Elevation profile unavailable for this route.</span>
            </div>
          )}

          {/* Accessibility Warnings & Notes */}
          <div className="space-y-1.5">
            {incline.exceedsWheelchairInclineThreshold && (
              <div
                data-testid="warning-wheelchair-incline"
                role="alert"
                className="flex items-start gap-1.5 p-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-800 dark:text-rose-200 text-xs"
              >
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <strong className="font-semibold">Wheelchair Incline Exceeded:</strong> Max slope of{" "}
                  {incline.maxUphillGradePercent}% exceeds the 8.33% standard threshold for{" "}
                  {Math.round(incline.wheelchairInaccessibleDistanceMeters)}m of this route.
                </div>
              </div>
            )}

            {!incline.exceedsWheelchairInclineThreshold && incline.exceedsSteepWarningThreshold && (
              <div
                data-testid="warning-steep-slope"
                role="alert"
                className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-200 text-xs"
              >
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <strong className="font-semibold">Steep Incline Warning:</strong> Incline reaches{" "}
                  {incline.maxUphillGradePercent}% (&gt; 8% threshold), which may require extra exertion.
                </div>
              </div>
            )}

            {accessibility.stairStatus === "has_stairs" && (
              <div
                data-testid="warning-stairs-present"
                role="alert"
                className="flex items-start gap-1.5 p-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-800 dark:text-rose-200 text-xs"
              >
                <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <strong className="font-semibold">Stairs on Route:</strong> Route contains steps/stairs. Not
                  wheelchair accessible.
                </div>
              </div>
            )}

            {accessibility.stairStatus === "unknown" && (
              <div
                data-testid="notice-stairs-unknown"
                className="flex items-start gap-1.5 p-2 rounded-lg bg-muted/50 border border-border/60 text-muted-foreground text-xs"
              >
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <span>Stair and curb-ramp data is unconfirmed. Step-free access cannot be guaranteed.</span>
                </div>
              </div>
            )}

            {accessibility.status === "accessible" && (
              <div
                data-testid="notice-step-free-verified"
                className="flex items-start gap-1.5 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-200 text-xs"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <strong className="font-semibold">Accessible Route:</strong> Step-free path confirmed with maximum
                  incline below 8%.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default RouteProfileCard;
