import React from "react";
import { cn } from "@/lib/utils";

export interface ExtraLegendItem {
  id?: string;
  label: string;
  dotClassName?: string;
}

export interface ForecastLegendProps {
  predictedLabel?: string;
  quietestLabel?: string;
  showPredicted?: boolean;
  showQuietest?: boolean;
  extraItems?: ExtraLegendItem[];
  className?: string;
}

export function ForecastLegend({
  predictedLabel = "Predicted Noise (dB)",
  quietestLabel = "Quietest Hours",
  showPredicted = true,
  showQuietest = true,
  extraItems = [],
  className,
}: ForecastLegendProps = {}) {
  const safeExtraItems = Array.isArray(extraItems) ? extraItems : [];

  return (
    <div
      role="group"
      aria-label="Noise forecast legend"
      data-testid="forecast-legend"
      className={cn(
        "flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 mt-2",
        className,
      )}
    >
      {showPredicted && (
        <div
          data-testid="forecast-legend-predicted"
          className="flex items-center gap-1.5"
        >
          <div
            data-testid="forecast-legend-predicted-dot"
            className="w-3 h-3 rounded-full bg-blue-500/20 border border-blue-500"
            aria-hidden="true"
          />
          <span>{predictedLabel}</span>
        </div>
      )}
      {showQuietest && (
        <div
          data-testid="forecast-legend-quietest"
          className="flex items-center gap-1.5"
        >
          <div
            data-testid="forecast-legend-quietest-dot"
            className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500"
            aria-hidden="true"
          />
          <span>{quietestLabel}</span>
        </div>
      )}
      {safeExtraItems.map((item, index) => {
        if (!item || !item.label) return null;
        const key = item.id || `extra-${index}`;
        return (
          <div
            key={key}
            data-testid={`forecast-legend-extra-${key}`}
            className="flex items-center gap-1.5"
          >
            <div
              className={cn(
                "w-3 h-3 rounded-full bg-zinc-500/20 border border-zinc-500",
                item.dotClassName,
              )}
              aria-hidden="true"
            />
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default ForecastLegend;
