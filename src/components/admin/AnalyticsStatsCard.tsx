import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface StatsCardTrend {
  /** Numerical percentage or formatted delta string (e.g., 12.5 or "+12.5%") */
  value: number | string;
  /** Direction indicator: "up" | "down" | "neutral" */
  direction?: "up" | "down" | "neutral";
  /** Whether the movement is positive/favorable (default: direction === 'up') */
  isPositive?: boolean;
  /** Context label (e.g. "vs last week") */
  label?: string;
}

export interface AnalyticsStatsCardProps {
  /** Metric card title */
  title: string;
  /** Main stat value (formatted string or number) */
  value?: string | number | null;
  /** Optional secondary description or caption */
  description?: string;
  /** Optional trend data indicator */
  trend?: StatsCardTrend;
  /** Optional metric icon */
  icon?: React.ReactNode;
  /** Whether card is in a loading/fetching state */
  loading?: boolean;
  /** Optional click handler for drill-down interactions */
  onClick?: () => void;
  /** Optional custom CSS classes */
  className?: string;
  /** Optional test identifier */
  testId?: string;
}

export function AnalyticsStatsCard({
  title,
  value,
  description,
  trend,
  icon,
  loading = false,
  onClick,
  className = "",
  testId = "analytics-stats-card",
}: AnalyticsStatsCardProps) {
  // Safe value formatting
  const displayValue =
    value === null || value === undefined || (typeof value === "number" && isNaN(value))
      ? "—"
      : String(value);

  // Determine trend sentiment and colors
  const trendDirection =
    trend?.direction ??
    (typeof trend?.value === "number"
      ? trend.value > 0
        ? "up"
        : trend.value < 0
        ? "down"
        : "neutral"
      : "neutral");

  const isPositiveTrend =
    trend?.isPositive !== undefined
      ? trend.isPositive
      : trendDirection === "up";

  const getTrendIcon = () => {
    switch (trendDirection) {
      case "up":
        return <TrendingUp className="w-3.5 h-3.5" data-testid="stats-card-trend-up" />;
      case "down":
        return <TrendingDown className="w-3.5 h-3.5" data-testid="stats-card-trend-down" />;
      case "neutral":
      default:
        return <Minus className="w-3.5 h-3.5" data-testid="stats-card-trend-neutral" />;
    }
  };

  const getTrendClasses = () => {
    if (trendDirection === "neutral") {
      return "text-zinc-400 bg-zinc-800/80 border-zinc-700/60";
    }
    return isPositiveTrend
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : "text-rose-400 bg-rose-500/10 border-rose-500/20";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };

  const interactiveClasses = onClick
    ? "cursor-pointer hover:border-zinc-500 hover:bg-gray-800/90 active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-violet-500/50"
    : "";

  return (
    <div
      role={onClick ? "button" : "region"}
      aria-label={onClick ? `${title} stat card, click to view details` : `${title} stat card`}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      data-testid={testId}
      className={`bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm relative overflow-hidden ${interactiveClasses} ${className}`.trim()}
    >
      {loading ? (
        <div
          data-testid="stats-card-skeleton"
          aria-busy="true"
          className="space-y-3 animate-pulse"
        >
          <div className="flex items-center justify-between">
            <div className="h-4 w-28 bg-gray-700 rounded" />
            {icon && <div className="h-8 w-8 bg-gray-700 rounded-lg" />}
          </div>
          <div className="h-8 w-36 bg-gray-700 rounded" />
          <div className="h-3 w-48 bg-gray-700 rounded" />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3
              className="text-sm font-medium text-gray-400 truncate"
              data-testid="stats-card-title"
            >
              {title}
            </h3>
            {icon && (
              <div
                className="text-gray-400 p-1.5 rounded-lg bg-gray-700/50 shrink-0"
                data-testid="stats-card-icon"
              >
                {icon}
              </div>
            )}
          </div>

          <div
            className="text-3xl font-bold text-white mb-2 tracking-tight"
            data-testid="stats-card-value"
          >
            {displayValue}
          </div>

          <div className="flex items-center flex-wrap gap-2 text-xs">
            {trend && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${getTrendClasses()}`}
                data-testid="stats-card-trend"
                aria-label={`Trend: ${trend.value} ${trend.label || ""}`.trim()}
              >
                {getTrendIcon()}
                <span>{typeof trend.value === "number" && trend.value > 0 ? `+${trend.value}%` : `${trend.value}`}</span>
              </span>
            )}

            {trend?.label && (
              <span
                className="text-gray-400 text-xs"
                data-testid="stats-card-trend-label"
              >
                {trend.label}
              </span>
            )}

            {description && (
              <p
                className="text-xs text-gray-500 w-full mt-1"
                data-testid="stats-card-description"
              >
                {description}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default AnalyticsStatsCard;
