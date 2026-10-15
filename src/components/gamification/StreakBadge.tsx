"use client";

import React, { useEffect, useState } from "react";
import { Flame, Zap } from "lucide-react";

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  unlockedMilestones?: number[];
}

export type StreakBadgeVariant = "default" | "willpower-battery";

export interface StreakBadgeProps {
  variant?: StreakBadgeVariant;
  streak?: number;
  longestStreak?: number;
  className?: string;
  onStreakClick?: () => void;
}

export interface WillpowerChargeInfo {
  tier: 0 | 1 | 2 | 3 | 4;
  chargePercentage: 0 | 25 | 50 | 75 | 100;
  tierLabel: string;
  isOverdrive: boolean;
}

/**
 * Calculates Willpower Energy battery charge tiers:
 * - 0 days: 0% charge
 * - 1-3 days: 25% charge
 * - 4-7 days: 50% charge
 * - 8-14 days: 75% charge
 * - 15+ days: 100% Emerald Overdrive
 */
export function getWillpowerBatteryTier(streak: number): WillpowerChargeInfo {
  if (streak <= 0) {
    return { tier: 0, chargePercentage: 0, tierLabel: "Depleted", isOverdrive: false };
  }
  if (streak <= 3) {
    return { tier: 1, chargePercentage: 25, tierLabel: "Charging", isOverdrive: false };
  }
  if (streak <= 7) {
    return { tier: 2, chargePercentage: 50, tierLabel: "Charged", isOverdrive: false };
  }
  if (streak <= 14) {
    return { tier: 3, chargePercentage: 75, tierLabel: "High Output", isOverdrive: false };
  }
  return { tier: 4, chargePercentage: 100, tierLabel: "Emerald Overdrive", isOverdrive: true };
}

/**
 * Green Lantern Power Battery SVG with 4-tiered segmented fill bars and animated power core
 */
export function WillpowerBatteryIcon({
  tier,
  isOverdrive,
  className = "w-4 h-4",
}: {
  tier: number;
  isOverdrive: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} ${isOverdrive ? "animate-pulse" : ""}`}
      data-testid="willpower-battery-svg"
      aria-hidden="true"
    >
      <defs>
        {/* Emerald Neon Glow */}
        <filter id="emerald-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <linearGradient id="emerald-core" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="50%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>

      {/* Battery Housing / Lantern Outer Frame */}
      {/* Top Handle Ring */}
      <path
        d="M8 4C8 2.89543 9.79086 2 12 2C14.2091 2 16 2.89543 16 4"
        stroke="#10b981"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Top Cap */}
      <rect x="7" y="4" width="10" height="2" rx="0.5" fill="#047857" stroke="#10b981" strokeWidth="1" />

      {/* Outer Lantern Body */}
      <path
        d="M5 8C5 6.89543 5.89543 6 7 6H17C18.1046 6 19 6.89543 19 8V18C19 19.1046 18.1046 20 17 20H7C5.89543 20 5 19.1046 5 18V8Z"
        fill="#064e3b"
        fillOpacity="0.8"
        stroke="#10b981"
        strokeWidth="1.5"
      />

      {/* Battery Base */}
      <rect x="8" y="20" width="8" height="2" rx="0.5" fill="#047857" stroke="#10b981" strokeWidth="1" />

      {/* 4 Segmented Battery Charge Fill Bars (from bottom to top) */}
      {/* Segment 1: Bottom (25%) */}
      <rect
        data-testid="battery-segment-1"
        x="7.5"
        y="16.5"
        width="9"
        height="2"
        rx="0.5"
        fill={tier >= 1 ? "url(#emerald-core)" : "#065f46"}
        opacity={tier >= 1 ? 1 : 0.25}
        filter={tier >= 1 ? "url(#emerald-glow)" : undefined}
      />

      {/* Segment 2: Lower-Middle (50%) */}
      <rect
        data-testid="battery-segment-2"
        x="7.5"
        y="13.5"
        width="9"
        height="2"
        rx="0.5"
        fill={tier >= 2 ? "url(#emerald-core)" : "#065f46"}
        opacity={tier >= 2 ? 1 : 0.25}
        filter={tier >= 2 ? "url(#emerald-glow)" : undefined}
      />

      {/* Segment 3: Upper-Middle (75%) */}
      <rect
        data-testid="battery-segment-3"
        x="7.5"
        y="10.5"
        width="9"
        height="2"
        rx="0.5"
        fill={tier >= 3 ? "url(#emerald-core)" : "#065f46"}
        opacity={tier >= 3 ? 1 : 0.25}
        filter={tier >= 3 ? "url(#emerald-glow)" : undefined}
      />

      {/* Segment 4: Top (100% Emerald Overdrive) */}
      <rect
        data-testid="battery-segment-4"
        x="7.5"
        y="7.5"
        width="9"
        height="2"
        rx="0.5"
        fill={tier >= 4 ? "url(#emerald-core)" : "#065f46"}
        opacity={tier >= 4 ? 1 : 0.25}
        filter={tier >= 4 ? "url(#emerald-glow)" : undefined}
      />

      {/* Central Power Core Aperture Ring */}
      <circle
        cx="12"
        cy="13"
        r="3.2"
        fill="#022c22"
        stroke={tier > 0 ? "#34d399" : "#065f46"}
        strokeWidth="1.2"
      />
      {/* Glowing Energy Core Center */}
      <circle
        data-testid="power-core-center"
        cx="12"
        cy="13"
        r="2"
        fill={tier > 0 ? "#6ee7b7" : "#065f46"}
        filter={tier > 0 ? "url(#emerald-glow)" : undefined}
        className={isOverdrive ? "animate-ping" : ""}
      />
    </svg>
  );
}

export function StreakBadge({
  variant = "default",
  streak: propStreak,
  longestStreak: propLongestStreak,
  className = "",
  onStreakClick,
}: StreakBadgeProps) {
  const [streakData, setStreakData] = useState<StreakData | null>(
    propStreak !== undefined
      ? {
          currentStreak: propStreak,
          longestStreak: propLongestStreak ?? propStreak,
        }
      : null
  );

  useEffect(() => {
    if (propStreak !== undefined) {
      setStreakData({
        currentStreak: propStreak,
        longestStreak: propLongestStreak ?? propStreak,
      });
      return;
    }

    fetch("/api/user/streak")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch streak");
        return res.json();
      })
      .then((data) => setStreakData(data))
      .catch((err) => console.error("Error fetching streak:", err));
  }, [propStreak, propLongestStreak]);

  if (!streakData || streakData.currentStreak === 0) return null;

  const currentStreak = streakData.currentStreak;
  const longestStreak = streakData.longestStreak;

  // Willpower Battery Calculations
  const isBattery = variant === "willpower-battery";
  const { tier, chargePercentage, tierLabel, isOverdrive } = getWillpowerBatteryTier(currentStreak);

  // Screen reader accessible label
  const accessibleLabel = isBattery
    ? `${currentStreak}-day streak, ${chargePercentage}% Willpower Battery Charge${
        isOverdrive ? " (Emerald Overdrive)" : ""
      }`
    : `${currentStreak}-day work streak`;

  if (isBattery) {
    return (
      <div
        tabIndex={0}
        role="status"
        aria-label={accessibleLabel}
        data-testid="streak-badge-willpower-battery"
        onClick={onStreakClick}
        className={`group relative flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold cursor-default transition-all focus:outline-none focus:ring-2 ${
          isOverdrive
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-lg shadow-emerald-500/20 hover:bg-emerald-500/30 focus:ring-emerald-400/60"
            : "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30 focus:ring-emerald-500/50"
        } ${className}`}
      >
        <WillpowerBatteryIcon tier={tier} isOverdrive={isOverdrive} className="w-4 h-4 shrink-0" />
        <span className="text-sm font-mono tracking-tight font-bold">{currentStreak}</span>
        <span className="text-[10px] uppercase font-bold tracking-wider px-1 py-0.2 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
          {chargePercentage}%
        </span>

        {/* Tooltip */}
        <div
          role="tooltip"
          className="absolute top-full right-0 mt-2 w-52 p-3 rounded-lg bg-white dark:bg-zinc-800 shadow-xl border border-zinc-200 dark:border-zinc-700 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity z-50 text-left"
        >
          <div className="flex items-center gap-1.5 text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">
            <Zap className="w-4 h-4 text-emerald-500 fill-emerald-500" />
            <span>Willpower Energy: {chargePercentage}%</span>
          </div>
          <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1">
            {tierLabel} ({currentStreak} Days Consecutive)
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {isOverdrive
              ? "Max Emerald Overdrive activated! Your focus momentum is unstoppable."
              : `Longest streak: ${longestStreak} days. Keep checking in daily to reach 100% Emerald Overdrive.`}
          </div>
        </div>
      </div>
    );
  }

  // Default Flame Variant
  return (
    <div
      tabIndex={0}
      role="status"
      aria-label={accessibleLabel}
      data-testid="streak-badge-default"
      onClick={onStreakClick}
      className={`group relative flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 font-semibold cursor-default transition-all hover:bg-orange-500/20 dark:hover:bg-orange-500/30 focus:outline-none focus:ring-2 focus:ring-orange-500/50 ${className}`}
    >
      <Flame className="w-4 h-4 fill-orange-500 text-orange-500" />
      <span className="text-sm">{currentStreak}</span>

      {/* Tooltip */}
      <div
        role="tooltip"
        className="absolute top-full right-0 mt-2 w-48 p-3 rounded-lg bg-white dark:bg-zinc-800 shadow-xl border border-zinc-200 dark:border-zinc-700 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity z-50 text-left"
      >
        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">
          {currentStreak}-Day Work Streak 🔥
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Keep it up! Your longest streak is {longestStreak} days.
        </div>
      </div>
    </div>
  );
}

export default StreakBadge;
