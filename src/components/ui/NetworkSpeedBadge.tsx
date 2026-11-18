"use client";

import React, { useState } from "react";
import { Zap, Gauge, Flame, Wifi } from "lucide-react";

export interface NetworkSpeedBadgeProps {
  /** Download speed in Megabits per second (Mbps) */
  downloadMbps: number;
  /** Optional upload speed in Megabits per second (Mbps) */
  uploadMbps?: number;
  /** Latency ping in milliseconds */
  pingMs?: number;
  /** Optional label override */
  label?: string;
  /** Custom container styling */
  className?: string;
}

export type MachTier = "subsonic" | "turbo" | "supersonic" | "hypersonic";

export interface MachVelocityInfo {
  machValue: number;
  tier: MachTier;
  tierLabel: string;
  badgeStyle: string;
  iconColor: string;
  glowEffect: string;
}

/**
 * Calculates Mach velocity from network throughput in Mbps:
 * - < 100 Mbps: Subsonic
 * - >= 100 Mbps: Mach 1.2+ Turbo
 * - >= 250 Mbps: Mach 2.5 Supersonic
 * - >= 500 Mbps: Mach 5.0 Hypersonic with pulsing emerald flames
 */
export function getMachVelocityInfo(downloadMbps: number): MachVelocityInfo {
  const safeSpeed =
    typeof downloadMbps === "number" &&
    !Number.isNaN(downloadMbps) &&
    downloadMbps > 0
      ? downloadMbps
      : 0;

  if (safeSpeed >= 500) {
    const machValue = Number(
      (5.0 + ((safeSpeed - 500) / 250) * 1.5).toFixed(1),
    );
    return {
      machValue,
      tier: "hypersonic",
      tierLabel: `Mach ${machValue} Hypersonic`,
      badgeStyle:
        "bg-gradient-to-r from-emerald-950 via-teal-900 to-emerald-900 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.5)]",
      iconColor: "text-emerald-300",
      glowEffect: "animate-pulse drop-shadow-[0_0_8px_#34d399]",
    };
  }

  if (safeSpeed >= 250) {
    const machValue = Number(
      (2.5 + ((safeSpeed - 250) / 250) * 1.2).toFixed(1),
    );
    return {
      machValue,
      tier: "supersonic",
      tierLabel: `Mach ${machValue} Supersonic`,
      badgeStyle:
        "bg-emerald-950/80 border-emerald-500/50 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]",
      iconColor: "text-emerald-400",
      glowEffect: "drop-shadow-[0_0_5px_#10b981]",
    };
  }

  if (safeSpeed >= 100) {
    const machValue = Number(
      (1.2 + ((safeSpeed - 100) / 150) * 0.8).toFixed(1),
    );
    return {
      machValue,
      tier: "turbo",
      tierLabel: `Mach ${machValue} Turbo`,
      badgeStyle: "bg-blue-950/80 border-blue-500/40 text-blue-300",
      iconColor: "text-blue-400",
      glowEffect: "",
    };
  }

  return {
    machValue: Number((safeSpeed / 100).toFixed(2)),
    tier: "subsonic",
    tierLabel: `${safeSpeed} Mbps`,
    badgeStyle: "bg-zinc-800/80 border-zinc-700 text-zinc-300",
    iconColor: "text-zinc-400",
    glowEffect: "",
  };
}

/**
 * NetworkSpeedBadge: Mach WiFi Velocity Badge for high-speed venues.
 * Displays supersonic Mach ratings for speeds over 100/250/500 Mbps
 * with glowing neon gradients, flame indicators, and an accessible tooltip.
 */
export function NetworkSpeedBadge({
  downloadMbps,
  uploadMbps,
  pingMs,
  label,
  className = "",
}: NetworkSpeedBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const velocity = getMachVelocityInfo(downloadMbps);

  const isHypersonic = velocity.tier === "hypersonic";
  const isSupersonic = velocity.tier === "supersonic";

  const safeDownload =
    typeof downloadMbps === "number" &&
    !Number.isNaN(downloadMbps) &&
    downloadMbps > 0
      ? downloadMbps
      : 0;
  const computedUpload = uploadMbps ?? Math.round(safeDownload * 0.4);
  const computedPing = pingMs ?? (safeDownload >= 250 ? 12 : 28);

  const tooltipText = `Download: ${safeDownload} Mbps • Upload: ${computedUpload} Mbps • Latency: ${computedPing}ms`;

  return (
    <div className="relative inline-flex items-center">
      <div
        role="status"
        data-testid="network-speed-badge"
        aria-label={`${velocity.tierLabel}: ${tooltipText}`}
        tabIndex={0}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        onClick={() => setShowTooltip((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-mono font-bold cursor-help transition-all duration-200 select-none ${velocity.badgeStyle} ${className}`}
      >
        {isHypersonic ? (
          <Flame
            className={`w-3.5 h-3.5 ${velocity.iconColor} ${velocity.glowEffect}`}
          />
        ) : isSupersonic ? (
          <Zap
            className={`w-3.5 h-3.5 ${velocity.iconColor} ${velocity.glowEffect}`}
          />
        ) : velocity.tier === "turbo" ? (
          <Gauge className={`w-3.5 h-3.5 ${velocity.iconColor}`} />
        ) : (
          <Wifi className={`w-3.5 h-3.5 ${velocity.iconColor}`} />
        )}

        <span>{label || velocity.tierLabel}</span>
      </div>

      {/* Accessible Tooltip Detailing Throughput */}
      {showTooltip && (
        <div
          role="tooltip"
          data-testid="network-speed-tooltip"
          aria-live="polite"
          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 px-3 py-2 text-xs font-mono rounded-xl bg-zinc-950/95 border border-emerald-500/30 text-zinc-100 shadow-2xl shadow-emerald-950/60 whitespace-nowrap animate-in fade-in zoom-in-95"
        >
          <div className="font-bold text-emerald-400 mb-1 flex items-center gap-1">
            <Zap className="w-3 h-3 text-emerald-400" />
            <span>{velocity.tier.toUpperCase()} VELOCITY</span>
          </div>
          <div className="space-y-0.5 text-[11px] text-zinc-300">
            <div>
              ⬇️ Download:{" "}
              <strong className="text-white">{downloadMbps} Mbps</strong>
            </div>
            <div>
              ⬆️ Upload:{" "}
              <strong className="text-white">{computedUpload} Mbps</strong>
            </div>
            <div>
              ⏱️ Ping: <strong className="text-white">{computedPing} ms</strong>
            </div>
          </div>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-zinc-950 border-r border-b border-emerald-500/30" />
        </div>
      )}
    </div>
  );
}

export default NetworkSpeedBadge;
