"use client";

import React from "react";
import { Plane, Users, Award, ShieldCheck, Zap } from "lucide-react";

export type FlightRankTier =
  | "Rookie"
  | "Flight Officer"
  | "Lead Pilot"
  | "Squadron Commander";

export interface FlightRankInfo {
  tier: FlightRankTier;
  minHours: number;
  title: string;
  callsign: string;
  description: string;
  badgeStyle: {
    bg: string;
    border: string;
    text: string;
    glow: string;
    iconColor: string;
  };
}

export const FLIGHT_RANK_TIERS: Record<FlightRankTier, FlightRankInfo> = {
  Rookie: {
    tier: "Rookie",
    minHours: 0,
    title: "Wingman: Rookie",
    callsign: "Cadet",
    description: "Beginning flight formation with initial co-working sessions",
    badgeStyle: {
      bg: "bg-zinc-100 dark:bg-zinc-800/80",
      border: "border-zinc-300 dark:border-zinc-700",
      text: "text-zinc-700 dark:text-zinc-300",
      glow: "shadow-zinc-500/10",
      iconColor: "text-zinc-500 dark:text-zinc-400",
    },
  },
  "Flight Officer": {
    tier: "Flight Officer",
    minHours: 10,
    title: "Wingman: Flight Officer",
    callsign: "Navigator",
    description: "Active formation flier with consistent peer co-working hours",
    badgeStyle: {
      bg: "bg-sky-500/10 dark:bg-sky-950/40",
      border: "border-sky-300 dark:border-sky-700/60",
      text: "text-sky-700 dark:text-sky-300",
      glow: "shadow-sky-500/20",
      iconColor: "text-sky-500 dark:text-sky-400",
    },
  },
  "Lead Pilot": {
    tier: "Lead Pilot",
    minHours: 50,
    title: "Wingman: Lead Pilot",
    callsign: "Squadron Lead",
    description: "Experienced co-worker leading shared table sprints and bookings",
    badgeStyle: {
      bg: "bg-emerald-500/10 dark:bg-emerald-950/40",
      border: "border-emerald-300 dark:border-emerald-700/60",
      text: "text-emerald-700 dark:text-emerald-300",
      glow: "shadow-emerald-500/20",
      iconColor: "text-emerald-500 dark:text-emerald-400",
    },
  },
  "Squadron Commander": {
    tier: "Squadron Commander",
    minHours: 100,
    title: "Wingman: Squadron Commander",
    callsign: "Ace Commander",
    description: "Veteran collaborator anchoring community co-working fleets",
    badgeStyle: {
      bg: "bg-amber-500/10 dark:bg-amber-950/40",
      border: "border-amber-400 dark:border-amber-600/70",
      text: "text-amber-800 dark:text-amber-300",
      glow: "shadow-amber-500/30",
      iconColor: "text-amber-500 dark:text-amber-400",
    },
  },
};

/**
 * Calculates Flight Wingman rank tier based on cumulative co-working hours.
 * Thresholds:
 *   - 0 to 9 hours   -> Rookie
 *   - 10 to 49 hours  -> Flight Officer
 *   - 50 to 99 hours  -> Lead Pilot
 *   - 100+ hours      -> Squadron Commander
 */
export function calculateFlightRank(hours: number): FlightRankInfo {
  const safeHours = Math.max(0, Number(hours) || 0);

  if (safeHours >= 100) {
    return FLIGHT_RANK_TIERS["Squadron Commander"];
  }
  if (safeHours >= 50) {
    return FLIGHT_RANK_TIERS["Lead Pilot"];
  }
  if (safeHours >= 10) {
    return FLIGHT_RANK_TIERS["Flight Officer"];
  }
  return FLIGHT_RANK_TIERS["Rookie"];
}

export const getFlightRank = calculateFlightRank;

export interface WingmanBadgeProps {
  coWorkingHours?: number;
  sharedSessionsCount?: number;
  tierOverride?: FlightRankTier;
  showStats?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function WingmanBadge({
  coWorkingHours = 0,
  sharedSessionsCount = 0,
  tierOverride,
  showStats = true,
  size = "md",
  className = "",
}: WingmanBadgeProps) {
  const rank = tierOverride
    ? FLIGHT_RANK_TIERS[tierOverride]
    : calculateFlightRank(coWorkingHours);

  const sizeClasses = {
    sm: "px-2.5 py-1 text-xs gap-1.5",
    md: "px-3.5 py-1.5 text-xs sm:text-sm gap-2",
    lg: "px-4 py-2.5 text-sm sm:text-base gap-2.5",
  }[size];

  const iconSizes = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  }[size];

  const ariaLabel = `Flight Wingman status: ${rank.tier}. ${coWorkingHours} co-working hours, ${sharedSessionsCount} shared bookings.`;

  return (
    <div
      data-testid="flight-wingman-badge"
      aria-label={ariaLabel}
      className={`inline-flex items-center rounded-xl border shadow-sm transition-all duration-200 ${rank.badgeStyle.bg} ${rank.badgeStyle.border} ${rank.badgeStyle.text} ${rank.badgeStyle.glow} ${sizeClasses} ${className}`}
    >
      <div className="flex items-center justify-center relative">
        <Plane className={`${iconSizes} ${rank.badgeStyle.iconColor} -rotate-45 transform`} />
        {rank.tier === "Squadron Commander" && (
          <Zap className="w-2.5 h-2.5 text-amber-400 absolute -top-1 -right-1" />
        )}
      </div>

      <div className="flex flex-col">
        <div className="flex items-center gap-1.5 font-semibold tracking-tight">
          <span>Wingman:</span>
          <span className="font-bold underline decoration-dotted underline-offset-2">
            {rank.tier}
          </span>
        </div>

        {showStats && (
          <div className="flex items-center gap-2 text-[10px] sm:text-[11px] opacity-80 font-medium">
            <span className="flex items-center gap-0.5">
              <Users className="w-3 h-3 inline-block" />
              {sharedSessionsCount} shared sessions
            </span>
            <span>•</span>
            <span>{coWorkingHours} hrs co-working</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default WingmanBadge;
