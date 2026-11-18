"use client";

import { useState, useRef, useCallback } from "react";
import { SignalHigh, SignalLow, SignalMedium } from "lucide-react";

export type NetworkQualityTier = "good" | "fair" | "poor" | "unknown";

/**
 * Automatically derives the network quality tier based on latency and packet loss.
 *
 * Suggested interpretation:
 * - Poor: ping >= 250 ms or packet loss >= 5%
 * - Fair: ping >= 100 ms or packet loss >= 1%
 * - Good: ping < 100 ms and packet loss < 1%
 * - Unknown: neither ping nor packetLoss is a valid non-negative finite number
 */
export function resolveNetworkQualityTier(
  ping?: number,
  packetLoss?: number
): NetworkQualityTier {
  const hasPing = typeof ping === "number" && Number.isFinite(ping) && ping >= 0;
  const hasLoss =
    typeof packetLoss === "number" && Number.isFinite(packetLoss) && packetLoss >= 0;

  if (!hasPing && !hasLoss) {
    return "unknown";
  }

  const safePing = hasPing ? (ping as number) : 0;
  const safeLoss = hasLoss ? (packetLoss as number) : 0;

  if (safePing >= 250 || safeLoss >= 5) {
    return "poor";
  }
  if (safePing >= 100 || safeLoss >= 1) {
    return "fair";
  }
  return "good";
}

/**
 * Props accepted by {@link NetworkQualityBadge}.
 */
export interface NetworkQualityBadgeProps {
  /**
   * Round-trip network latency in milliseconds.
   *
   * Lower values indicate a more responsive network connection.
   * Suggested interpretation:
   *
   * - Good: below 100 ms
   * - Fair: 100–249 ms
   * - Poor: 250 ms or higher
   */
  ping?: number;

  /**
   * Percentage of transmitted packets that were not successfully received.
   *
   * Expected range: `0` to `100`.
   *
   * Suggested interpretation:
   *
   * - Good: below 1%
   * - Fair: 1–4.99%
   * - Poor: 5% or higher
   */
  packetLoss?: number;

  /**
   * Precomputed network-quality tier rendered by the badge.
   * If omitted, will be derived automatically via {@link resolveNetworkQualityTier}.
   *
   * Color guidance:
   *
   * - `good`: green — low latency and little or no packet loss
   * - `fair`: yellow — moderate latency or noticeable packet loss
   * - `poor`: red — high latency, substantial packet loss, or instability
   * - `unknown`: neutral gray — measurements are unavailable
   */
  qualityTier?: NetworkQualityTier;

  /**
   * Optional additional CSS classes applied to the badge container.
   */
  className?: string;
}

/**
 * Displays a compact, color-coded summary of measured network quality.
 */
export function NetworkQualityBadge({
  ping,
  packetLoss,
  qualityTier,
  className = "",
}: NetworkQualityBadgeProps) {
  const effectiveTier = qualityTier ?? resolveNetworkQualityTier(ping, packetLoss);

  const getBadgeDetails = () => {
    switch (effectiveTier) {
      case "good":
        return {
          icon: (
            <SignalHigh className="h-4 w-4 shrink-0 text-green-500" aria-hidden="true" />
          ),
          bgColor: "bg-green-500/10",
          borderColor: "border-green-500/20",
          textColor: "text-green-600 dark:text-green-400",
          label: "Good",
        };

      case "fair":
        return {
          icon: (
            <SignalMedium
              className="h-4 w-4 shrink-0 text-yellow-500"
              aria-hidden="true"
            />
          ),
          bgColor: "bg-yellow-500/10",
          borderColor: "border-yellow-500/20",
          textColor: "text-yellow-600 dark:text-yellow-400",
          label: "Fair",
        };

      case "poor":
        return {
          icon: (
            <SignalLow className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
          ),
          bgColor: "bg-red-500/10",
          borderColor: "border-red-500/20",
          textColor: "text-red-600 dark:text-red-400",
          label: "Poor",
        };

      default:
        return {
          icon: (
            <SignalMedium
              className="h-4 w-4 shrink-0 text-zinc-400"
              aria-hidden="true"
            />
          ),
          bgColor: "bg-zinc-500/10",
          borderColor: "border-zinc-500/20",
          textColor: "text-zinc-500 dark:text-zinc-400",
          label: "Unknown",
        };
    }
  };

  const details = getBadgeDetails();

  const isSafePing = typeof ping === "number" && Number.isFinite(ping) && ping >= 0;
  const isSafeLoss =
    typeof packetLoss === "number" && Number.isFinite(packetLoss) && packetLoss >= 0;
  const clampedLoss = isSafeLoss ? Math.min(100, Math.max(0, packetLoss as number)) : null;

  const measurements = [
    isSafePing ? `${Math.round(ping as number)} ms` : null,
    clampedLoss !== null ? `${clampedLoss.toFixed(1)}% loss` : null,
  ].filter((measurement): measurement is string => measurement !== null);

  const tooltip =
    measurements.length > 0
      ? `${details.label} network quality · ${measurements.join(" · ")}`
      : `${details.label} network quality`;

  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const badgeRef = useRef<HTMLDivElement>(null);

  const positionTooltip = useCallback(() => {
    if (!badgeRef.current || typeof window === "undefined") return;
    const rect = badgeRef.current.getBoundingClientRect();
    const tooltipWidth = 200;
    const winWidth = window.innerWidth || 1024;
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;

    if (left < 8) left = 8;
    if (left + tooltipWidth > winWidth - 8) {
      left = winWidth - 8 - tooltipWidth;
    }

    setTooltipStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left,
      width: tooltipWidth,
    });
  }, []);

  const handleEnter = () => {
    positionTooltip();
    setShowTooltip(true);
  };

  const handleLeave = () => setShowTooltip(false);

  return (
    <div
      ref={badgeRef}
      data-testid="network-quality-badge"
      className={`relative inline-flex whitespace-nowrap items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors ${details.bgColor} ${details.borderColor} ${details.textColor} ${className}`}
      aria-label={tooltip}
      aria-describedby={showTooltip ? "network-quality-tooltip" : undefined}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      tabIndex={0}
    >
      {details.icon}

      <span className="shrink-0">{details.label}</span>

      {isSafePing && (
        <span className="ml-0.5 font-mono text-[10px] opacity-75 max-[400px]:hidden">
          {Math.round(ping as number)}ms
        </span>
      )}

      {clampedLoss !== null && (
        <span className="font-mono text-[10px] opacity-75 max-[400px]:hidden">
          {clampedLoss.toFixed(1)}%
        </span>
      )}

      {showTooltip && (
        <div
          id="network-quality-tooltip"
          role="tooltip"
          data-testid="network-quality-tooltip"
          style={tooltipStyle}
          className="z-50 px-2.5 py-1.5 text-[11px] font-medium text-zinc-100 bg-zinc-900 dark:bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg pointer-events-none"
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

export default NetworkQualityBadge;
