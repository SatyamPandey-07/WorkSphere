"use client";

import React from "react";

export type RedisLatencyStatus = "healthy" | "degraded" | "offline";

export interface RedisLatencyStatusBadgeProps {
  /**
   * Redis round-trip ping latency in milliseconds.
   * Special values:
   * - -1 or negative: probe failure / timeout / unavailable
   * - 0: local mock/fallback (considered healthy)
   * - null / undefined / NaN / non-finite: offline / unavailable
   */
  latencyMs: number | null | undefined;
  className?: string;
  showIcon?: boolean;
}

/**
 * Resolves the Redis status tier from the latency measurement:
 * - healthy: 0 <= latencyMs < 150
 * - degraded: 150 <= latencyMs
 * - offline: null, undefined, NaN, non-finite, or latencyMs < 0 (e.g. -1 probe error)
 */
export function getRedisLatencyStatus(
  latencyMs: number | null | undefined,
): RedisLatencyStatus {
  if (
    latencyMs === null ||
    latencyMs === undefined ||
    typeof latencyMs !== "number" ||
    !Number.isFinite(latencyMs) ||
    latencyMs < 0
  ) {
    return "offline";
  }

  // Latency >= 150ms is classified as elevated / degraded
  if (latencyMs >= 150) {
    return "degraded";
  }

  return "healthy";
}

const STATUS_CONFIG: Record<
  RedisLatencyStatus,
  {
    label: string;
    textClass: string;
    bgClass: string;
    borderClass: string;
    dotClass: string;
    description: string;
  }
> = {
  healthy: {
    label: "Healthy",
    textClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/20",
    dotClass: "bg-emerald-400",
    description: "Redis ping latency is optimal (< 150ms)",
  },
  degraded: {
    label: "Degraded",
    textClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/20",
    dotClass: "bg-amber-400",
    description: "Redis ping latency is elevated (>= 150ms)",
  },
  offline: {
    label: "Offline",
    textClass: "text-rose-400",
    bgClass: "bg-rose-500/10",
    borderClass: "border-rose-500/20",
    dotClass: "bg-rose-400",
    description: "Redis is unavailable or ping probe failed",
  },
};

/**
 * Color-coded Redis latency status indicator badge for admin diagnostics.
 * Conforms to WCAG accessibility guidelines by providing a descriptive aria-label,
 * role="status", and explicit text label rather than color alone.
 */
export function RedisLatencyStatusBadge({
  latencyMs,
  className = "",
  showIcon = true,
}: RedisLatencyStatusBadgeProps) {
  const status = getRedisLatencyStatus(latencyMs);
  const config = STATUS_CONFIG[status];

  const formattedLatency =
    status !== "offline" && typeof latencyMs === "number"
      ? `${Math.round(latencyMs)} ms`
      : "Unavailable";

  const ariaLabel = `Redis latency status: ${config.label}. Latency: ${formattedLatency}. ${config.description}.`;

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      title={`${config.label} - ${formattedLatency} (${config.description})`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${config.bgClass} ${config.borderClass} ${config.textClass} ${className}`}
    >
      {showIcon && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${config.dotClass} ${
            status === "healthy" ? "animate-pulse" : ""
          }`}
        />
      )}
      <span>{config.label}</span>
    </span>
  );
}
