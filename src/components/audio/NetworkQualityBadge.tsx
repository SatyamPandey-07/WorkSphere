"use client";

import { SignalHigh, SignalLow, SignalMedium } from "lucide-react";

export type NetworkQualityTier = "good" | "fair" | "poor" | "unknown";

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
   *
   * The displayed badge color is controlled by `qualityTier`; `ping` is
   * displayed as supporting diagnostic information.
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
   *
   * Packet loss can reduce call and streaming quality even when latency is low.
   */
  packetLoss?: number;

  /**
   * Precomputed network-quality tier rendered by the badge.
   *
   * Color guidance:
   *
   * - `good`: green — low latency and little or no packet loss
   * - `fair`: yellow — moderate latency or noticeable packet loss
   * - `poor`: red — high latency, substantial packet loss, or instability
   * - `unknown`: neutral gray — measurements are unavailable
   *
   * Callers should derive this value using the project's current network
   * quality thresholds.
   */
  qualityTier: NetworkQualityTier;

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
  const getBadgeDetails = () => {
    switch (qualityTier) {
      case "good":
        return {
          icon: (
            <SignalHigh className="h-4 w-4 text-green-500" aria-hidden="true" />
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
              className="h-4 w-4 text-yellow-500"
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
            <SignalLow className="h-4 w-4 text-red-500" aria-hidden="true" />
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
              className="h-4 w-4 text-zinc-400"
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

  const measurements = [
    Number.isFinite(ping) ? `${Math.round(ping as number)} ms` : null,
    Number.isFinite(packetLoss)
      ? `${(packetLoss as number).toFixed(1)}% loss`
      : null,
  ].filter((measurement): measurement is string => measurement !== null);

  const tooltip =
    measurements.length > 0
      ? `${details.label} network quality · ${measurements.join(" · ")}`
      : `${details.label} network quality`;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors ${details.bgColor} ${details.borderColor} ${details.textColor} ${className}`}
      title={tooltip}
      aria-label={tooltip}
    >
      {details.icon}

      <span>{details.label}</span>

      {Number.isFinite(ping) && (
        <span className="ml-0.5 font-mono text-[10px] opacity-75">
          {Math.round(ping as number)}ms
        </span>
      )}

      {Number.isFinite(packetLoss) && (
        <span className="font-mono text-[10px] opacity-75">
          {(packetLoss as number).toFixed(1)}%
        </span>
      )}
    </div>
  );
}
