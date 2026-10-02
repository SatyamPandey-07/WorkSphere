"use client";

import React from "react";
import { Wifi } from "lucide-react";
import { type LatencyTier } from "@/hooks/useWebSocketLatency";

interface WebSocketLatencyBadgeProps {
  latencyMs: number | null;
  tier: LatencyTier;
  className?: string;
}

const TIER_CONFIG: Record<
  LatencyTier,
  { label: string; dotClass: string; textClass: string }
> = {
  good: {
    label: "Good",
    dotClass: "bg-green-500",
    textClass: "text-green-600 dark:text-green-400",
  },
  fair: {
    label: "Fair",
    dotClass: "bg-yellow-500",
    textClass: "text-yellow-600 dark:text-yellow-400",
  },
  poor: {
    label: "Poor",
    dotClass: "bg-red-500",
    textClass: "text-red-600 dark:text-red-400",
  },
  unknown: {
    label: "…",
    dotClass: "bg-zinc-400",
    textClass: "text-zinc-500 dark:text-zinc-400",
  },
};

/**
 * Compact header badge showing WebSocket connection latency.
 * Green < 50ms, Yellow 50–150ms, Red > 150ms.
 */
export function WebSocketLatencyBadge({
  latencyMs,
  tier,
  className = "",
}: WebSocketLatencyBadgeProps) {
  const config = TIER_CONFIG[tier];
  const label =
    latencyMs !== null ? `${latencyMs} ms` : config.label;

  return (
    <div
      className={`flex items-center gap-1 text-xs font-medium ${config.textClass} ${className}`}
      title={`WebSocket latency: ${label}`}
      aria-label={`Connection quality: ${config.label}${latencyMs !== null ? ` (${latencyMs} ms)` : ""}`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${config.dotClass} ${tier === "good" ? "animate-pulse" : ""}`}
      />
      <Wifi className="w-3.5 h-3.5 shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
