"use client";

import React from "react";
import {
  rssiToSignalBars,
  getSignalTier,
  getSignalQualityLabel,
  getSignalBarColors,
} from "@/lib/spatial/signalStrength";

export interface BeaconSignalBarsProps {
  /**
   * Measured RSSI in dBm.
   * -50 dBm corresponds to 5 bars (full strength)
   * -100 dBm corresponds to 1 bar (weakest active signal)
   */
  rssi: number | null | undefined;

  /**
   * Optional manual override for active bars (1-5).
   * If omitted, derived automatically from `rssi`.
   */
  bars?: number;

  /**
   * Size preset for the visualizer bars.
   * - 'sm': compact for list items and badges (height ~14px)
   * - 'md': standard for cards and drawer rows (height ~20px)
   * - 'lg': prominent for hero diagnostic readouts (height ~28px)
   */
  size?: "sm" | "md" | "lg";

  /**
   * Whether to display the text label (e.g. "-65 dBm" or "Good") alongside the bars.
   */
  showLabel?: boolean;

  /**
   * What information to display in the label if `showLabel` is true.
   * - 'rssi': displays exact dBm e.g. "-68 dBm"
   * - 'bars': displays bar fraction e.g. "4/5 bars"
   * - 'tier': displays quality tier e.g. "Good"
   * - 'both': displays "-68 dBm (Good)"
   */
  labelFormat?: "rssi" | "bars" | "tier" | "both";

  /**
   * Optional extra container styling.
   */
  className?: string;

  /**
   * Optional accessible label override for assistive technologies.
   */
  accessibleLabel?: string;
}

const BAR_HEIGHT_PERCENTAGES = [24, 42, 62, 82, 100]; // 5 cellular steps

export function BeaconSignalBars({
  rssi,
  bars: explicitBars,
  size = "md",
  showLabel = false,
  labelFormat = "rssi",
  className = "",
  accessibleLabel,
}: BeaconSignalBarsProps) {
  const rawBars =
    explicitBars !== undefined
      ? (Number.isFinite(explicitBars) ? Math.round(explicitBars) : 0)
      : rssiToSignalBars(rssi);
  const activeBars = Math.max(0, Math.min(5, rawBars));

  const tier = getSignalTier(rssi);
  const isRssiValid = rssi !== null && rssi !== undefined && Number.isFinite(rssi);

  const qualityLabel = isRssiValid
    ? getSignalQualityLabel(rssi)
    : activeBars > 0
      ? (["No Signal", "Weak", "Poor", "Fair", "Good", "Excellent"] as const)[activeBars]
      : "No Signal";

  const colors = getSignalBarColors(activeBars);

  // Accessible descriptive label
  const defaultLabel = isRssiValid
    ? activeBars > 0
      ? `Signal strength: ${activeBars} of 5 bars (${rssi} dBm, ${qualityLabel})`
      : `Signal strength: 0 of 5 bars (${rssi} dBm, Out of Range)`
    : activeBars > 0
      ? `Signal strength: ${activeBars} of 5 bars (${qualityLabel})`
      : "No beacon signal detected";
  const finalAccessibleLabel = accessibleLabel || defaultLabel;

  // Sizing definitions
  const sizeConfig = {
    sm: {
      containerHeight: "h-3.5",
      containerWidth: "w-5",
      barWidth: "w-0.5",
      gap: "gap-0.5",
      fontSize: "text-[10px]",
    },
    md: {
      containerHeight: "h-5",
      containerWidth: "w-7",
      barWidth: "w-1",
      gap: "gap-0.5",
      fontSize: "text-xs",
    },
    lg: {
      containerHeight: "h-7",
      containerWidth: "w-10",
      barWidth: "w-1.5",
      gap: "gap-1",
      fontSize: "text-sm",
    },
  }[size];

  // Derived label text
  const renderLabelText = () => {
    if (!showLabel) return null;
    switch (labelFormat) {
      case "bars":
        return `${activeBars}/5 bars`;
      case "tier":
        return qualityLabel;
      case "both":
        return isRssiValid
          ? `${rssi} dBm (${qualityLabel})`
          : qualityLabel;
      case "rssi":
      default:
        return isRssiValid ? `${rssi} dBm` : "No Signal";
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-2 ${className}`}
      data-testid="beacon-signal-bars"
    >
      {/* 5-Bar Cellular Visualizer SVG/CSS Component */}
      <div
        role="meter"
        aria-label={finalAccessibleLabel}
        aria-valuenow={activeBars}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuetext={
          activeBars > 0
            ? `${activeBars} of 5 bars, ${qualityLabel}`
            : "No beacon signal detected"
        }
        className={`flex items-end ${sizeConfig.containerHeight} ${sizeConfig.containerWidth} ${sizeConfig.gap} select-none`}
        data-bars={activeBars}
        data-rssi={rssi ?? "none"}
        data-tier={tier}
      >
        {[1, 2, 3, 4, 5].map((barIndex) => {
          const isActive = barIndex <= activeBars;
          const heightPercent = BAR_HEIGHT_PERCENTAGES[barIndex - 1];

          return (
            <div
              key={barIndex}
              data-testid={`signal-bar-${barIndex}`}
              data-active={isActive}
              style={{ height: `${heightPercent}%` }}
              className={`flex-1 rounded-sm transition-all duration-300 ease-out ${
                isActive ? colors.barActive : colors.barInactive
              }`}
            />
          );
        })}
      </div>

      {/* Optional visible text label */}
      {showLabel && (
        <span
          className={`font-mono font-medium ${sizeConfig.fontSize} ${colors.text}`}
          data-testid="signal-bars-label"
        >
          {renderLabelText()}
        </span>
      )}
    </div>
  );
}
