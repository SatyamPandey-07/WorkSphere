"use client";

import React, { useMemo, useEffect, useRef } from "react";
import { Building2, ChevronUp, ChevronDown, Compass } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CockpitAltimeterTapeProps {
  /** Active venue floor level (e.g. 1, 2, ..., totalFloors) */
  floorNumber: number;
  /** Total count of floors in the venue */
  totalFloors: number;
  /** Name of the venue or sector */
  venueName?: string;
  /** Enable audio avionics tick sound on floor change (default: true) */
  enableAudioFeedback?: boolean;
  /** Optional callback when user clicks step buttons */
  onFloorChange?: (newFloor: number) => void;
  /** Custom wrapper styling */
  className?: string;
}

/**
 * Maps venue floor number to calibrated altitude in feet:
 * Floor 1 = 1,000 ft, Floor 2 = 2,000 ft, ..., Rooftop (top floor) = 10,000 ft.
 * Ground floor (0) = 0 ft.
 */
export function calculateAltitudeFeet(floorNumber: number, totalFloors: number): number {
  const safeFloor = typeof floorNumber === "number" && Number.isFinite(floorNumber) ? floorNumber : 0;
  const safeTotal =
    typeof totalFloors === "number" && Number.isFinite(totalFloors) && totalFloors > 0
      ? totalFloors
      : 1;
  if (safeFloor <= 0) return 0;
  if (safeTotal > 1 && safeFloor >= safeTotal) {
    return 10000; // Rooftop altitude
  }
  return safeFloor * 1000;
}

/**
 * Calculates vertical drum position offset for altimeter tape animation.
 * Returns pixel translation to align tape window with target altitude.
 */
export function interpolateAltitudeDrumPosition(
  altitudeFeet: number,
  maxAltitude: number = 10000,
  tapeHeightPx: number = 320
): number {
  const safeMax =
    typeof maxAltitude === "number" && Number.isFinite(maxAltitude) && maxAltitude > 0
      ? maxAltitude
      : 10000;
  const safeHeight =
    typeof tapeHeightPx === "number" && Number.isFinite(tapeHeightPx) && tapeHeightPx > 0
      ? tapeHeightPx
      : 320;
  const safeAlt = typeof altitudeFeet === "number" && Number.isFinite(altitudeFeet) ? altitudeFeet : 0;
  const clampedAlt = Math.max(0, Math.min(safeAlt, safeMax));
  const ratio = clampedAlt / safeMax;
  return ratio * safeHeight;
}

/**
 * Synthetic flight avionics audio tick feedback using Web Audio API
 */
export function playAvionicsTickSound() {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const cleanup = () => {
      try {
        if (ctx.state !== "closed") {
          ctx.close().catch(() => {});
        }
      } catch {
        // Context already closed
      }
    };

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.035);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = cleanup;

    osc.start(now);
    osc.stop(now + 0.04);

    const timer = setTimeout(cleanup, 100);
    if (typeof timer === "object" && typeof (timer as any).unref === "function") {
      (timer as any).unref();
    }
  } catch {
    // Ignore audio permission or context restrictions
  }
}

/**
 * CockpitAltimeterTape: Vertical rolling altitude tape for high-rise coworking venues.
 * Features animated numeric drum roller, emerald tick marks, and tactical avionics HUD styling.
 */
export function CockpitAltimeterTape({
  floorNumber,
  totalFloors,
  venueName = "Tactical High-Rise",
  enableAudioFeedback = true,
  onFloorChange,
  className = "",
}: CockpitAltimeterTapeProps) {
  const currentAltitude = useMemo(
    () => calculateAltitudeFeet(floorNumber, totalFloors),
    [floorNumber, totalFloors]
  );

  const prevFloorRef = useRef(floorNumber);
  const isFirstRender = useRef(true);

  // Play avionics click / tick audio feedback when floor transitions
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (prevFloorRef.current !== floorNumber) {
      if (enableAudioFeedback) {
        playAvionicsTickSound();
      }
      prevFloorRef.current = floorNumber;
    }
  }, [floorNumber, enableAudioFeedback]);

  const isRooftop = totalFloors > 1 && floorNumber >= totalFloors;
  const isGround = floorNumber <= 0;

  // Tape markings definition (from 11,000 ft down to -1,000 ft in 500 ft increments)
  const TAPE_TICK_HEIGHT = 32; // height in px per 1,000 ft interval
  const tapeMarkings = useMemo(() => {
    const marks: { alt: number; label: string; isMajor: boolean }[] = [];
    for (let alt = 10000; alt >= 0; alt -= 500) {
      marks.push({
        alt,
        label: (alt / 1000).toFixed(0),
        isMajor: alt % 1000 === 0,
      });
    }
    return marks;
  }, []);

  // Compute vertical scroll translation so the active altitude aligns with the center drum window
  // Higher altitude scrolls markings down to align with pointer
  const maxAlt = 10000;
  const totalTapeTravelPx = (maxAlt / 500) * (TAPE_TICK_HEIGHT / 2); // 20 intervals * 16px = 320px
  const drumOffset = interpolateAltitudeDrumPosition(
    currentAltitude,
    maxAlt,
    totalTapeTravelPx
  );

  // Formatted altitude string padded to 5 digits (e.g. "01000", "10000")
  const altFormatted = currentAltitude.toString().padStart(5, "0");

  return (
    <div
      role="region"
      aria-label={`Cockpit Altimeter Tape for ${venueName}`}
      data-testid="cockpit-altimeter-tape"
      className={cn(
        "p-4 rounded-2xl bg-[#03110b]/90 dark:bg-zinc-950/95 border border-emerald-500/30 shadow-2xl shadow-emerald-950/50 text-emerald-400 font-mono backdrop-blur-md w-full max-w-[280px] select-none",
        className
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2 mb-3">
        <div className="flex items-center gap-1.5 text-xs text-white font-bold tracking-wider">
          <Building2 className="w-3.5 h-3.5 text-emerald-400" />
          <span data-testid="altimeter-venue-name" className="truncate max-w-[140px]">
            {venueName}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-emerald-300/80">
          <Compass className="w-3 h-3 text-emerald-400 animate-spin-slow" />
          <span>BARO 29.92</span>
        </div>
      </div>

      {/* Main Altimeter Interface: Controls + Tape */}
      <div className="flex items-center justify-between gap-3 my-2">
        {/* Left Side: Floor Status & Stepper */}
        <div className="flex flex-col items-start gap-2 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-emerald-500/80">
            Active Level
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              data-testid="altimeter-active-level"
              className="text-2xl font-black text-white tracking-tight"
            >
              {isRooftop ? "ROOF" : isGround ? "GND" : `F${floorNumber}`}
            </span>
            <span className="text-xs text-emerald-400">
              / {totalFloors}
            </span>
          </div>

          <div data-testid="altimeter-level-description" className="text-[11px] text-zinc-400 mt-0.5">
            {isRooftop
              ? "Sky Deck / 10,000 FT"
              : isGround
              ? "Ground Level / 0 FT"
              : `Floor ${floorNumber} Active`}
          </div>

          {/* Floor Stepper Buttons */}
          {onFloorChange && (
            <div className="flex items-center gap-1 mt-2">
              <button
                type="button"
                aria-label="Ascend floor"
                data-testid="altimeter-ascend-btn"
                disabled={floorNumber >= totalFloors}
                onClick={() => onFloorChange(Math.min(totalFloors, floorNumber + 1))}
                className="p-1 rounded bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Descend floor"
                data-testid="altimeter-descend-btn"
                disabled={floorNumber <= 1}
                onClick={() => onFloorChange(Math.max(1, floorNumber - 1))}
                className="p-1 rounded bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Right Side: Vertical Rolling Altitude Tape */}
        <div className="relative w-28 h-48 bg-black/60 rounded-lg border border-emerald-500/40 overflow-hidden shadow-inner flex items-center justify-end">
          {/* Subtle gradient vignette at top and bottom */}
          <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-black via-black/70 to-transparent pointer-events-none z-10" />
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-black via-black/70 to-transparent pointer-events-none z-10" />

          {/* Scrolling Tape Container */}
          <div
            data-testid="altimeter-tape-strip"
            className="absolute right-0 w-full flex flex-col items-end transition-transform duration-500 ease-out"
            style={{
              // Center window aligns at 96px (half of 192px / h-48). We translate according to drumOffset
              transform: `translateY(${drumOffset - 160}px)`,
            }}
          >
            {tapeMarkings.map((mark) => (
              <div
                key={mark.alt}
                data-testid={`tape-mark-${mark.alt}`}
                className="w-full flex items-center justify-end pr-1 h-4 relative"
              >
                {mark.isMajor ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-emerald-300 font-bold tracking-tighter">
                      {mark.alt}
                    </span>
                    <span className="w-3.5 h-[2px] bg-emerald-400 shadow-[0_0_4px_#10b981]" />
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-[1px] bg-emerald-500/60" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Central Drum Roller Window Pointer (Active Altitude Bug) */}
          <div
            data-testid="altimeter-drum-roller"
            className="absolute left-1 right-0 top-1/2 -translate-y-1/2 z-20 flex items-center pointer-events-none"
          >
            {/* Left pointer chevron */}
            <div className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[8px] border-l-emerald-400 drop-shadow-[0_0_6px_#10b981]" />

            {/* High-contrast rolling drum numeric display box */}
            <div className="flex-1 ml-0.5 px-1.5 py-0.5 rounded bg-zinc-950/95 border-2 border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.35)] flex items-center justify-between">
              {/* Digit drum columns */}
              <div className="flex items-center gap-[1px] font-mono font-bold text-xs text-white">
                <span className="text-emerald-400">{altFormatted.slice(0, 2)}</span>
                <span className="text-zinc-500">,</span>
                <span className="text-white">{altFormatted.slice(2)}</span>
              </div>
              <span className="text-[9px] font-extrabold text-emerald-400 ml-1">FT</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer telemetry */}
      <div
        data-testid="altimeter-elevation-footer"
        className="flex items-center justify-between text-[10px] pt-2 mt-2 border-t border-emerald-500/15 text-zinc-400"
      >
        <span>MSL ELEVATION</span>
        <span className="text-emerald-300 font-semibold">{currentAltitude.toLocaleString()} FT</span>
      </div>
    </div>
  );
}

export default CockpitAltimeterTape;
