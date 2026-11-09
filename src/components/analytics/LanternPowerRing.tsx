"use client";

import React, { useId } from "react";
import { Zap, Sparkles, BatteryCharging, Battery } from "lucide-react";
import { useBatteryStatus } from "@/hooks/useBatteryStatus";

export type WillpowerTier =
  | "DORMANT"
  | "SPARK"
  | "CADET"
  | "GUARDIAN"
  | "VETERAN"
  | "HONOR_GUARD"
  | "VANGUARD"
  | "MASTER"
  | "SENTINEL"
  | "ION";

export interface WillpowerStatusInfo {
  tier: WillpowerTier;
  label: string;
  description: string;
}

/**
 * Resolves the user's Willpower tier and status description from charge percentage.
 */
export function getWillpowerStatus(percentage: number): WillpowerStatusInfo {
  const p = Math.max(0, Math.min(100, Math.round(percentage)));
  if (p === 0) {
    return {
      tier: "DORMANT",
      label: "Dormant",
      description: "0% Charge · Tap to begin charging Willpower Battery",
    };
  }
  if (p <= 15) {
    return {
      tier: "SPARK",
      label: "Spark Initiate",
      description: `${p}% Charge · Initial willpower spark ignited`,
    };
  }
  if (p <= 35) {
    return {
      tier: "CADET",
      label: "Cadet Lantern",
      description: `${p}% Charge · Stable emerald energy flow`,
    };
  }
  if (p <= 40) {
    return {
      tier: "GUARDIAN",
      label: "Sector Guardian",
      description: `${p}% Charge · Coworking streak fortified`,
    };
  }
  if (p <= 65) {
    return {
      tier: "VETERAN",
      label: "Emerald Veteran",
      description: `${p}% Charge · High-capacity energy reserve`,
    };
  }
  if (p <= 70) {
    return {
      tier: "HONOR_GUARD",
      label: "Honor Guard",
      description: `${p}% Charge · Rhythmic willpower resonance`,
    };
  }
  if (p <= 85) {
    return {
      tier: "VANGUARD",
      label: "Corps Vanguard",
      description: `${p}% Charge · Volumetric willpower bloom`,
    };
  }
  if (p <= 90) {
    return {
      tier: "MASTER",
      label: "Willpower Master",
      description: `${p}% Charge · Prismatic edge refractions`,
    };
  }
  if (p < 100) {
    return {
      tier: "SENTINEL",
      label: "Prime Sentinel",
      description: `${p}% Charge · Approaching full ion capacity`,
    };
  }
  return {
    tier: "ION",
    label: "Ion Transcendence",
    description: "100% Charge · Maximum power ring capacity unlocked",
  };
}

export type LanternPowerRingSize = "sm" | "md" | "lg" | "xl" | number;

export interface LanternPowerRingProps {
  /**
   * Willpower charge percentage (0 to 100).
   * If omitted, falls back to device battery percentage or 100%.
   */
  chargePercent?: number;
  /**
   * Whether power ring is actively charging.
   * If omitted, falls back to device battery charging status.
   */
  isCharging?: boolean;
  /**
   * Size variant or custom pixel diameter.
   * "sm" (28px), "md" (36px), "lg" (48px), "xl" (64px), or numeric pixels.
   * Default is "md".
   */
  size?: LanternPowerRingSize;
  /**
   * Optional custom status label override for tooltip.
   */
  statusLabel?: string;
  /**
   * Whether to show interactive tooltip (default true).
   */
  showTooltip?: boolean;
  /**
   * Tooltip placement relative to the ring.
   */
  tooltipPlacement?: "top" | "bottom" | "left" | "right";
  /**
   * Optional click handler for modal or navigation drilldown.
   */
  onClick?: () => void;
  /**
   * Custom container CSS class.
   */
  className?: string;
  /**
   * Override data-testid.
   */
  "data-testid"?: string;
}

const RADIUS = 38;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~238.761

const SIZE_MAP: Record<"sm" | "md" | "lg" | "xl", { dimension: number; strokeWidth: number }> = {
  sm: { dimension: 28, strokeWidth: 7 },
  md: { dimension: 36, strokeWidth: 7.5 },
  lg: { dimension: 48, strokeWidth: 8 },
  xl: { dimension: 64, strokeWidth: 8.5 },
};

/**
 * LanternPowerRing
 * Circular SVG power ring meter visually mirroring a Green Lantern battery ring
 * charging up from 0% to 100% based on device battery or daily nomad quest completion.
 *
 * Features:
 * - Circular SVG meter with dynamic stroke-dashoffset
 * - Animated glow pulse when plugged into power / charging (.animate-ring-pulse)
 * - 100% full-charge ring flash animation (.animate-ring-flash)
 * - Interactive accessible tooltip detailing charge percentage and willpower status
 */
export function LanternPowerRing({
  chargePercent,
  isCharging,
  size = "md",
  statusLabel,
  showTooltip = true,
  tooltipPlacement = "bottom",
  onClick,
  className = "",
  "data-testid": testIdOverride,
}: LanternPowerRingProps) {
  const gradientId = useId();
  const filterId = useId();
  const battery = useBatteryStatus();

  // Resolve charge percentage: explicit prop takes precedence, fallback to battery level or 100
  const resolvedChargePercent =
    chargePercent !== undefined
      ? chargePercent
      : battery.level !== null
      ? Math.round(battery.level * 100)
      : 100;

  // Resolve charging state: explicit prop takes precedence, fallback to battery charging
  const resolvedIsCharging =
    isCharging !== undefined ? isCharging : battery.charging;

  const clampedCharge = Math.max(0, Math.min(100, Math.round(resolvedChargePercent)));
  const strokeDashoffset = CIRCUMFERENCE - (clampedCharge / 100) * CIRCUMFERENCE;

  const isFull = clampedCharge === 100;
  const willpowerStatus = getWillpowerStatus(clampedCharge);
  const displayStatusLabel = statusLabel || willpowerStatus.label;

  const { dimension, strokeWidth } =
    typeof size === "number"
      ? { dimension: size, strokeWidth: Math.max(6, size / 6) }
      : SIZE_MAP[size] || SIZE_MAP.md;

  const tooltipPlacementClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[tooltipPlacement];

  return (
    <div
      tabIndex={0}
      role="progressbar"
      aria-label={`Lantern Power Ring: ${clampedCharge}% - ${displayStatusLabel}${
        resolvedIsCharging ? " (Charging)" : ""
      }`}
      aria-valuenow={clampedCharge}
      aria-valuemin={0}
      aria-valuemax={100}
      data-testid={testIdOverride || "lantern-power-ring"}
      data-charging={resolvedIsCharging ? "true" : "false"}
      data-ring-flash={isFull ? "true" : "false"}
      onClick={onClick}
      className={`group relative inline-flex items-center justify-center select-none rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-400/60 cursor-pointer ${
        resolvedIsCharging ? "animate-ring-pulse" : ""
      } ${isFull ? "animate-ring-flash" : ""} ${className}`}
      style={{ width: dimension, height: dimension }}
    >
      {/* Circular SVG Ring Meter */}
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full overflow-visible transition-transform duration-300 group-hover:scale-105"
        aria-hidden="true"
      >
        <defs>
          {/* Emerald Willpower Linear Gradient */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#00ff88" />
          </linearGradient>

          {/* Emerald Energy Glow Filter */}
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur
              stdDeviation={resolvedIsCharging ? 3.5 : 2}
              result="blur"
            />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient Ring Outer Glow when Charging or Full */}
        {(resolvedIsCharging || isFull) && (
          <circle
            cx="50"
            cy="50"
            r={RADIUS + strokeWidth / 2 + 2}
            fill="none"
            stroke="#00ff88"
            strokeWidth="1.5"
            opacity={resolvedIsCharging ? 0.6 : 0.8}
            className="animate-pulse"
          />
        )}

        {/* Background Track Circle */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-emerald-950/40 dark:text-emerald-950/60"
        />

        {/* Dynamic Meter Circle with stroke-dashoffset */}
        <circle
          data-testid="lantern-ring-circle"
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={strokeDashoffset}
          transform="rotate(-90 50 50)"
          filter={`url(#${filterId})`}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />

        {/* Green Lantern Insignia (Center) */}
        <g
          className={`transition-colors duration-300 ${
            clampedCharge > 0
              ? "text-emerald-400 dark:text-emerald-300"
              : "text-zinc-400 dark:text-zinc-600"
          }`}
        >
          {/* Top Construct Bracket */}
          <rect
            x="36"
            y="32"
            width="28"
            height="4"
            rx="2"
            fill="currentColor"
          />
          {/* Bottom Construct Bracket */}
          <rect
            x="36"
            y="64"
            width="28"
            height="4"
            rx="2"
            fill="currentColor"
          />
          {/* Center Power Ring Circle */}
          <circle
            cx="50"
            cy="50"
            r="14"
            fill={resolvedIsCharging ? "rgba(0, 255, 136, 0.2)" : "none"}
            stroke="currentColor"
            strokeWidth="3.5"
          />
          {/* Central Ion Core Spark */}
          <circle
            cx="50"
            cy="50"
            r={resolvedIsCharging ? 5.5 : 4}
            fill="#00ff88"
            opacity={clampedCharge === 0 ? 0.2 : Math.max(0.4, clampedCharge / 100)}
            className={resolvedIsCharging ? "animate-ping origin-center" : ""}
          />
        </g>
      </svg>

      {/* Charging Pulse Indicator Badge */}
      {resolvedIsCharging && (
        <span
          data-testid="lantern-ring-charging-pulse"
          className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/80 animate-bounce"
        >
          <Zap className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
        </span>
      )}

      {/* Tooltip Detailing Charge Percentage and Willpower Status */}
      {showTooltip && (
        <div
          role="tooltip"
          data-testid="lantern-ring-tooltip"
          className={`absolute ${tooltipPlacementClasses} z-50 w-60 p-3.5 rounded-2xl bg-slate-950/95 dark:bg-zinc-950/95 border border-emerald-500/30 text-white shadow-2xl backdrop-blur-xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-all duration-200`}
        >
          {/* Tooltip Header */}
          <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Lantern Power Ring</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold uppercase">
              {willpowerStatus.tier}
            </span>
          </div>

          {/* Charge Percentage & Visual Progress Bar */}
          <div className="space-y-1.5 mb-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Willpower Charge</span>
              <span
                data-testid="lantern-ring-charge-text"
                className="font-mono font-bold text-emerald-400"
              >
                {clampedCharge}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all duration-500"
                style={{ width: `${clampedCharge}%` }}
              />
            </div>
          </div>

          {/* Willpower Status Label & Description */}
          <div className="space-y-0.5 text-left mb-2">
            <div
              data-testid="lantern-ring-status-label"
              className="text-xs font-semibold text-slate-100"
            >
              {displayStatusLabel}
            </div>
            <div className="text-[11px] text-slate-400 leading-snug">
              {willpowerStatus.description}
            </div>
          </div>

          {/* Power Source & Charging Status */}
          <div
            data-testid="lantern-ring-power-status"
            className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400"
          >
            <div className="flex items-center gap-1.5">
              {resolvedIsCharging ? (
                <>
                  <BatteryCharging
                    className="w-3.5 h-3.5 text-emerald-400 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-emerald-300 font-semibold">
                    Charging · Energy Influx
                  </span>
                </>
              ) : (
                <>
                  <Battery
                    className="w-3.5 h-3.5 text-slate-400 shrink-0"
                    aria-hidden="true"
                  />
                  <span>Discharging · Nomad Battery</span>
                </>
              )}
            </div>
            <span>{isFull ? "MAX ION" : `${100 - clampedCharge}% rem`}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default LanternPowerRing;
