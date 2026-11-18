"use client";

import React, { useMemo } from "react";
import { Gauge, Navigation2, Clock } from "lucide-react";

export type CommuteTransitMode = "walking" | "cycling" | "metro" | "high_speed_rail";

export interface MachAirspeedTapeProps {
  /** Mode of commute transit */
  transitMode?: CommuteTransitMode;
  /** Explicit calibrated airspeed in knots override */
  speedKnots?: number;
  /** Distance to destination in kilometers */
  distanceKm?: number;
  /** Destination name */
  destinationName?: string;
  /** Custom orientation layout */
  orientation?: "horizontal" | "vertical";
  /** Custom wrapper styling */
  className?: string;
}

export const TRANSIT_SPEED_MAP: Record<
  CommuteTransitMode,
  { defaultKnots: number; stallSpeed: number; vneSpeed: number; label: string }
> = {
  walking: {
    defaultKnots: 15,
    stallSpeed: 5,
    vneSpeed: 25,
    label: "Tactical Pedestrian",
  },
  cycling: {
    defaultKnots: 45,
    stallSpeed: 15,
    vneSpeed: 70,
    label: "Urban Velocity Cycle",
  },
  metro: {
    defaultKnots: 120,
    stallSpeed: 40,
    vneSpeed: 160,
    label: "Subterranean Transit",
  },
  high_speed_rail: {
    defaultKnots: 300,
    stallSpeed: 100,
    vneSpeed: 380,
    label: "Supersonic Maglev",
  },
};

/**
 * Calculates estimated time of arrival (ETA) in minutes based on distance and airspeed in knots.
 * 1 Knot ≈ 1.852 km/h
 */
export function calculateCommuteEtaMinutes(distanceKm: number, speedKnots: number): number {
  if (distanceKm <= 0 || speedKnots <= 0) return 0;
  const speedKmh = speedKnots * 1.852;
  const hours = distanceKm / speedKmh;
  return Math.max(1, Math.round(hours * 60));
}

/**
 * MachAirspeedTape: Avionics flight airspeed indicator for route commutes.
 * Displays calibrated airspeed ribbon graphics, stall speed (Vs) vs Vne limits,
 * and dynamic airspeed bug indicator showing destination estimated arrival time.
 */
export function MachAirspeedTape({
  transitMode = "cycling",
  speedKnots,
  distanceKm = 4.2,
  destinationName = "Sector Desk",
  orientation = "horizontal",
  className = "",
}: MachAirspeedTapeProps) {
  const modeSpec = TRANSIT_SPEED_MAP[transitMode] || TRANSIT_SPEED_MAP.cycling;
  const currentSpeed = speedKnots !== undefined ? speedKnots : modeSpec.defaultKnots;
  const machRating = (currentSpeed / 661.47).toFixed(3); // 1 Mach ≈ 661.47 kts at sea level

  const etaMinutes = useMemo(
    () => calculateCommuteEtaMinutes(distanceKm, currentSpeed),
    [distanceKm, currentSpeed],
  );

  // Normalization percentage across tape scale (0 to 350 kts)
  const maxTapeSpeed = 350;
  const clampedSpeed = Math.min(maxTapeSpeed, Math.max(0, currentSpeed));
  const speedPercentage = (clampedSpeed / maxTapeSpeed) * 100;
  const stallPercentage = (modeSpec.stallSpeed / maxTapeSpeed) * 100;
  const vnePercentage = (modeSpec.vneSpeed / maxTapeSpeed) * 100;

  return (
    <div
      role="region"
      aria-label={`Airspeed telemetry for ${modeSpec.label}`}
      className={`p-4 rounded-2xl bg-[#04100c]/85 dark:bg-zinc-950/90 border border-emerald-500/25 shadow-xl shadow-emerald-950/40 text-emerald-400 font-mono backdrop-blur-md ${className}`}
    >
      {/* Header telemetry status */}
      <div className="flex items-center justify-between mb-3 border-b border-emerald-500/20 pb-2">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            {modeSpec.label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-[10px] text-zinc-400">MACH {machRating}</span>
          <span className="font-bold text-emerald-300">{currentSpeed} KTS</span>
        </div>
      </div>

      {/* Horizontal Airspeed Tape Container */}
      <div className="relative my-4">
        {/* Tape Scale Bar */}
        <div className="h-6 w-full rounded-lg bg-zinc-900/90 border border-emerald-500/30 relative overflow-hidden">
          {/* Stall Speed Redline Band (Left) */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-amber-500/25 border-r border-amber-400/50"
            style={{ width: `${stallPercentage}%` }}
            title={`Stall Speed: ${modeSpec.stallSpeed} kts`}
          />

          {/* Normal Operating Arc (Green Band) */}
          <div
            className="absolute top-0 bottom-0 bg-emerald-500/20 border-r border-emerald-400"
            style={{
              left: `${stallPercentage}%`,
              width: `${Math.max(0, vnePercentage - stallPercentage)}%`,
            }}
          />

          {/* Vne Never-Exceed Redline Band (Right) */}
          <div
            className="absolute top-0 bottom-0 right-0 bg-red-500/25 border-l border-red-500/50"
            style={{ width: `${100 - vnePercentage}%` }}
            title={`Vne Never-Exceed: ${modeSpec.vneSpeed} kts`}
          />

          {/* Airspeed Bug (Cyan Heading Indicator Pointer) */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-cyan-400 shadow-[0_0_8px_#22d3ee] transition-all duration-300"
            style={{ left: `${speedPercentage}%` }}
          >
            <div className="absolute -top-1 -left-1.5 w-4 h-2 bg-cyan-400 clip-triangle shadow-sm" />
          </div>
        </div>

        {/* Tick Mark Scale */}
        <div className="flex justify-between text-[9px] text-zinc-500 mt-1 px-1">
          <span>0</span>
          <span>50</span>
          <span>100</span>
          <span>150</span>
          <span>200</span>
          <span>250</span>
          <span>300</span>
          <span className="text-red-400 font-bold">Vne 350+</span>
        </div>
      </div>

      {/* Destination Dynamic Airspeed Bug Callout */}
      <div className="flex items-center justify-between text-xs pt-2 border-t border-emerald-500/15">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Navigation2 className="w-3.5 h-3.5 text-emerald-400 rotate-45" />
          <span className="truncate max-w-[140px] text-zinc-300">{destinationName}</span>
          <span className="text-[10px]">({distanceKm} km)</span>
        </div>
        <div className="flex items-center gap-1 text-emerald-300 font-bold">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          <span>ETA ~{etaMinutes} min</span>
        </div>
      </div>
    </div>
  );
}

export default MachAirspeedTape;
