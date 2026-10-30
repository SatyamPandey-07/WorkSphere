"use client";

import React, { useMemo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Building2,
  ChevronUp,
  ChevronDown,
  Gauge,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Zap,
  Footprints,
  Activity,
  Clock,
  Compass,
} from "lucide-react";

export type FloorTransitMode =
  | "elevator_express"
  | "elevator_local"
  | "escalator"
  | "stairs"
  | "stationary";

export interface TransitModeProfile {
  name: string;
  nominalSpeedFpm: number;
  maxSpeedFpm: number;
  description: string;
  accentColor: string;
}

export const TRANSIT_MODE_PROFILES: Record<FloorTransitMode, TransitModeProfile> = {
  elevator_express: {
    name: "Express Elevator",
    nominalSpeedFpm: 2400,
    maxSpeedFpm: 3500,
    description: "High-speed vertical shaft direct lift (12 m/s)",
    accentColor: "cyan",
  },
  elevator_local: {
    name: "Passenger Lift",
    nominalSpeedFpm: 1000,
    maxSpeedFpm: 1500,
    description: "Standard inter-floor passenger elevator (5 m/s)",
    accentColor: "emerald",
  },
  escalator: {
    name: "Transit Escalator",
    nominalSpeedFpm: 300,
    maxSpeedFpm: 450,
    description: "Continuous mechanical floor incline (1.5 m/s)",
    accentColor: "blue",
  },
  stairs: {
    name: "Tactical Stairs",
    nominalSpeedFpm: 180,
    maxSpeedFpm: 300,
    description: "Pedestrian stairwell climb/descent (0.9 m/s)",
    accentColor: "amber",
  },
  stationary: {
    name: "Level Station",
    nominalSpeedFpm: 0,
    maxSpeedFpm: 0,
    description: "Stationary level on active floor (0 FPM)",
    accentColor: "zinc",
  },
};

export interface CockpitVerticalSpeedTapeProps {
  /** Explicit vertical speed rate in feet per minute (FPM). Positive = climb, negative = descent. */
  verticalSpeedFpm?: number;
  /** Active starting or current venue floor (e.g. 1 to totalFloors) */
  currentFloor?: number;
  /** Destination target venue floor */
  targetFloor?: number;
  /** Total count of floors in venue (default: 10) */
  totalFloors?: number;
  /** Selected transit mechanism */
  transitMode?: FloorTransitMode;
  /** Height per venue floor in feet (default: 14 ft commercial standard) */
  floorHeightFeet?: number;
  /** Target selected vertical speed bug setting in FPM (default: 0) */
  selectedVsBugFpm?: number;
  /** Max scale limit on vertical speed tape (default: 3000 FPM) */
  maxScaleFpm?: number;
  /** Tower / venue label */
  venueName?: string;
  /** Enable audio feedback on rate thresholds and leveling (default: true) */
  enableAudioFeedback?: boolean;
  /** Callback when user changes vertical speed rate */
  onVerticalSpeedChange?: (fpm: number) => void;
  /** Callback when user switches target floor or transit mode */
  onFloorTransitionChange?: (fromFloor: number, toFloor: number) => void;
  /** Custom wrapper CSS class */
  className?: string;
}

/**
 * Calculates vertical speed in feet per minute based on floor differential and duration.
 */
export function calculateVerticalSpeedFpm(
  fromFloor: number,
  toFloor: number,
  transitDurationSeconds: number,
  floorHeightFeet: number = 14,
): number {
  if (
    typeof transitDurationSeconds !== "number" ||
    !Number.isFinite(transitDurationSeconds) ||
    transitDurationSeconds <= 0 ||
    fromFloor === toFloor
  ) {
    return 0;
  }
  const safeFrom = typeof fromFloor === "number" && Number.isFinite(fromFloor) ? fromFloor : 0;
  const safeTo = typeof toFloor === "number" && Number.isFinite(toFloor) ? toFloor : 0;
  const safeFloorHeight =
    typeof floorHeightFeet === "number" && Number.isFinite(floorHeightFeet) && floorHeightFeet > 0
      ? floorHeightFeet
      : 14;
  const floorDiff = safeTo - safeFrom;
  const totalFeet = floorDiff * safeFloorHeight;
  const fpm = (totalFeet * 60) / transitDurationSeconds;
  return Number.isFinite(fpm) ? Math.round(fpm) : 0;
}

/**
 * Calculates pixel offset of the VSI needle pointer from center 0 line.
 * Upward climb translates with negative Y offset (towards top of tape).
 * Downward descent translates with positive Y offset (towards bottom of tape).
 */
export function interpolateVsiNeedleOffset(
  verticalSpeedFpm: number,
  maxFpm: number = 3000,
  halfTapeHeightPx: number = 96,
): number {
  const safeMax = typeof maxFpm === "number" && Number.isFinite(maxFpm) && maxFpm > 0 ? maxFpm : 3000;
  const safeHalfHeight =
    typeof halfTapeHeightPx === "number" && Number.isFinite(halfTapeHeightPx) && halfTapeHeightPx > 0
      ? halfTapeHeightPx
      : 96;
  const safeFpm = typeof verticalSpeedFpm === "number" && Number.isFinite(verticalSpeedFpm) ? verticalSpeedFpm : 0;
  const clampedFpm = Math.max(-safeMax, Math.min(safeMax, safeFpm));
  const ratio = clampedFpm / safeMax;
  // Positive FPM moves upward (negative translateY). Normalize -0 to 0.
  const offset = -ratio * safeHalfHeight;
  return offset === 0 ? 0 : offset;
}

/**
 * Converts feet per minute (FPM) to metric meters per second (m/s).
 * 1 FPM = 0.00508 m/s
 */
export function fpmToMetersPerSecond(fpm: number): number {
  const safeFpm = typeof fpm === "number" && Number.isFinite(fpm) ? fpm : 0;
  return Number((safeFpm * 0.00508).toFixed(1));
}

/**
 * Calculates estimated seconds to complete floor transit to destination.
 */
export function calculateFloorTransitEtaSeconds(
  currentFloor: number,
  targetFloor: number,
  speedFpm: number,
  floorHeightFeet: number = 14,
): number {
  if (
    typeof speedFpm !== "number" ||
    !Number.isFinite(speedFpm) ||
    speedFpm === 0 ||
    currentFloor === targetFloor
  ) {
    return 0;
  }
  const safeCurrent = typeof currentFloor === "number" && Number.isFinite(currentFloor) ? currentFloor : 0;
  const safeTarget = typeof targetFloor === "number" && Number.isFinite(targetFloor) ? targetFloor : 0;
  const safeHeight =
    typeof floorHeightFeet === "number" && Number.isFinite(floorHeightFeet) && floorHeightFeet > 0
      ? floorHeightFeet
      : 14;
  const distanceFeet = Math.abs(safeTarget - safeCurrent) * safeHeight;
  const speedAbsFpm = Math.abs(speedFpm);
  const seconds = (distanceFeet / speedAbsFpm) * 60;
  return Number.isFinite(seconds) ? Math.max(1, Math.round(seconds)) : 0;
}

/**
 * Classifies vertical climb/descent rate into annunciator categories.
 */
export function classifyVerticalRate(speedFpm: number): {
  state: "LEVEL" | "CLIMB" | "DESCENT";
  intensity: "NORMAL" | "ELEVATED" | "RAPID";
  label: string;
  color: string;
  badgeClass: string;
} {
  const safeFpm = typeof speedFpm === "number" && Number.isFinite(speedFpm) ? speedFpm : 0;
  const absFpm = Math.abs(safeFpm);
  if (absFpm < 50) {
    return {
      state: "LEVEL",
      intensity: "NORMAL",
      label: "LEVEL TRANSIT",
      color: "text-emerald-400",
      badgeClass: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    };
  }

  if (safeFpm > 0) {
    if (absFpm >= 2000) {
      return {
        state: "CLIMB",
        intensity: "RAPID",
        label: "RAPID ASCENT",
        color: "text-amber-400",
        badgeClass: "bg-amber-500/15 border-amber-500/40 text-amber-300",
      };
    }
    if (absFpm >= 1000) {
      return {
        state: "CLIMB",
        intensity: "ELEVATED",
        label: "EXPRESS CLIMB",
        color: "text-cyan-400",
        badgeClass: "bg-cyan-500/15 border-cyan-500/40 text-cyan-300",
      };
    }
    return {
      state: "CLIMB",
      intensity: "NORMAL",
      label: "ASCENDING",
      color: "text-emerald-400",
      badgeClass: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    };
  }

  // Descent (speedFpm < 0)
  if (absFpm >= 2000) {
    return {
      state: "DESCENT",
      intensity: "RAPID",
      label: "RAPID DROP",
      color: "text-rose-400",
      badgeClass: "bg-rose-500/15 border-rose-500/40 text-rose-300",
    };
  }
  if (absFpm >= 1000) {
    return {
      state: "DESCENT",
      intensity: "ELEVATED",
      label: "EXPRESS DESCENT",
      color: "text-cyan-400",
      badgeClass: "bg-cyan-500/15 border-cyan-500/40 text-cyan-300",
    };
  }
  return {
    state: "DESCENT",
    intensity: "NORMAL",
    label: "DESCENDING",
    color: "text-emerald-400",
    badgeClass: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  };
}

/**
 * Synthetic avionics audio tick feedback for vertical speed transitions.
 */
export function playAvionicsRateChime(isClimb: boolean) {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
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
        // Ignore already closed context
      }
    };

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    const now = ctx.currentTime;
    const baseFreq = isClimb ? 1200 : 800;
    const endFreq = isClimb ? 1600 : 500;

    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.04);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = cleanup;

    osc.start(now);
    osc.stop(now + 0.045);

    const timer = setTimeout(cleanup, 100);
    if (typeof timer === "object" && typeof (timer as any).unref === "function") {
      (timer as any).unref();
    }
  } catch {
    // Ignore audio permission restrictions
  }
}

/**
 * CockpitVerticalSpeedTape: Avionics glass cockpit Vertical Speed Indicator (VSI)
 * specialized for high-rise venue transit climb and descent rates.
 */
export function CockpitVerticalSpeedTape({
  verticalSpeedFpm,
  currentFloor = 1,
  targetFloor = 5,
  totalFloors = 10,
  transitMode = "elevator_local",
  floorHeightFeet = 14,
  selectedVsBugFpm = 0,
  maxScaleFpm = 3000,
  venueName = "Core Transit Shaft",
  enableAudioFeedback = true,
  onVerticalSpeedChange,
  onFloorTransitionChange,
  className = "",
}: CockpitVerticalSpeedTapeProps) {
  // Derive effective vertical speed if not explicitly passed
  const activeFpm = useMemo(() => {
    if (verticalSpeedFpm !== undefined) {
      return verticalSpeedFpm;
    }
    if (currentFloor === targetFloor) return 0;
    const profile = TRANSIT_MODE_PROFILES[transitMode] || TRANSIT_MODE_PROFILES.elevator_local;
    const direction = targetFloor >= currentFloor ? 1 : -1;
    return direction * profile.nominalSpeedFpm;
  }, [verticalSpeedFpm, currentFloor, targetFloor, transitMode]);

  const [simulatedFpm, setSimulatedFpm] = useState<number>(activeFpm);

  useEffect(() => {
    setSimulatedFpm(activeFpm);
  }, [activeFpm]);

  const prevRateRef = useRef(simulatedFpm);
  const isFirstRender = useRef(true);

  // Audio cue when rate shifts between climb/descent
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (
      enableAudioFeedback &&
      Math.sign(prevRateRef.current) !== Math.sign(simulatedFpm) &&
      Math.abs(simulatedFpm) >= 100
    ) {
      playAvionicsRateChime(simulatedFpm > 0);
    }
    prevRateRef.current = simulatedFpm;
  }, [simulatedFpm, enableAudioFeedback]);

  // Derived telemetry metrics
  const metersPerSec = useMemo(
    () => fpmToMetersPerSecond(simulatedFpm),
    [simulatedFpm],
  );
  const rateClassification = useMemo(
    () => classifyVerticalRate(simulatedFpm),
    [simulatedFpm],
  );
  const transitEtaSeconds = useMemo(
    () =>
      calculateFloorTransitEtaSeconds(
        currentFloor,
        targetFloor,
        simulatedFpm,
        floorHeightFeet,
      ),
    [currentFloor, targetFloor, simulatedFpm, floorHeightFeet],
  );

  // Tape geometry: 240px tall window, half-height is 120px
  const HALF_TAPE_HEIGHT_PX = 100;
  const needleOffsetPx = interpolateVsiNeedleOffset(
    simulatedFpm,
    maxScaleFpm,
    HALF_TAPE_HEIGHT_PX,
  );
  const bugOffsetPx = interpolateVsiNeedleOffset(
    selectedVsBugFpm,
    maxScaleFpm,
    HALF_TAPE_HEIGHT_PX,
  );

  // Scale markings from +maxScaleFpm to -maxScaleFpm in 500 FPM increments
  const tapeMarkings = useMemo(() => {
    const marks: { fpm: number; label: string; isMajor: boolean }[] = [];
    const step = 500;
    for (let fpm = maxScaleFpm; fpm >= -maxScaleFpm; fpm -= step) {
      const isMajor = fpm % 1000 === 0;
      const thousands = (Math.abs(fpm) / 1000).toFixed(0);
      marks.push({
        fpm,
        label: isMajor ? (fpm === 0 ? "0" : `${thousands}`) : "",
        isMajor,
      });
    }
    return marks;
  }, [maxScaleFpm]);

  const handleStepSpeed = (delta: number) => {
    const nextFpm = Math.max(
      -maxScaleFpm,
      Math.min(maxScaleFpm, simulatedFpm + delta),
    );
    setSimulatedFpm(nextFpm);
    onVerticalSpeedChange?.(nextFpm);
  };

  const handleFloorChange = (newTarget: number) => {
    const clampedTarget = Math.max(1, Math.min(totalFloors, newTarget));
    onFloorTransitionChange?.(currentFloor, clampedTarget);
  };

  const formattedFpm = `${simulatedFpm > 0 ? "+" : ""}${simulatedFpm.toLocaleString()} FPM`;

  return (
    <div
      role="region"
      aria-label={`Cockpit Vertical Speed Tape for ${venueName}`}
      data-testid="cockpit-vertical-speed-tape"
      className={cn("p-4 md:p-5 rounded-2xl bg-[#03110b]/90 dark:bg-zinc-950/95 border border-emerald-500/30 shadow-2xl shadow-emerald-950/50 text-emerald-400 font-mono backdrop-blur-md w-full max-w-[340px] select-none space-y-3", className)}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2.5">
        <div className="flex items-center gap-1.5 text-xs text-white font-bold tracking-wider">
          <Building2 className="w-3.5 h-3.5 text-emerald-400" />
          <span data-testid="vsi-venue-name" className="truncate max-w-[170px]">{venueName}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-emerald-300/80 font-semibold uppercase">
          <Compass className="w-3 h-3 text-cyan-400 animate-spin-slow" />
          <span>VSI · 100 FPM</span>
        </div>
      </div>

      {/* Main Display: Controls + Vertical Speed Indicator Tape */}
      <div className="flex items-center justify-between gap-3">
        {/* Left Column: Telemetry & Controls */}
        <div className="flex-1 space-y-2.5">
          {/* Active Annunciator Badge */}
          <div
            data-testid="vsi-status-annunciator"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-bold tracking-wider uppercase ${rateClassification.badgeClass}`}
          >
            {simulatedFpm > 50 ? (
              <ArrowUp className="w-3 h-3 text-emerald-400" />
            ) : simulatedFpm < -50 ? (
              <ArrowDown className="w-3 h-3 text-rose-400" />
            ) : (
              <Activity className="w-3 h-3 text-emerald-400" />
            )}
            <span>{rateClassification.label}</span>
          </div>

          {/* Primary Vertical Rate Readout Box */}
          <div
            data-testid="vsi-digital-readout"
            className="p-2.5 rounded-xl bg-black/60 border border-emerald-500/30 space-y-0.5 shadow-inner"
          >
            <span className="text-[9px] uppercase tracking-wider text-emerald-500/80 block">
              Vertical Speed Rate
            </span>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-2xl font-black tracking-tight font-mono ${
                  simulatedFpm > 0
                    ? "text-emerald-300"
                    : simulatedFpm < 0
                      ? "text-cyan-300"
                      : "text-white"
                }`}
              >
                {formattedFpm}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-0.5 font-mono">
              <span>{metersPerSec >= 0 ? `+${metersPerSec}` : metersPerSec} m/s</span>
              <span>14 FT/FL</span>
            </div>
          </div>

          {/* Floor Transit Vectors */}
          <div className="text-[11px] p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-[10px]">TRANSIT PATH:</span>
              <span className="text-white font-bold">
                F{currentFloor} ➔ F{targetFloor}
              </span>
            </div>
            <div
              data-testid="vsi-transit-eta"
              className="flex items-center justify-between text-[10px] text-zinc-400"
            >
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-cyan-400" /> ETA
              </span>
              <span className="text-cyan-300 font-semibold font-mono">
                {transitEtaSeconds > 0 ? `${transitEtaSeconds}s` : "LEVEL"}
              </span>
            </div>
          </div>

          {/* Quick Rate Stepper Buttons */}
          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              aria-label="Increase climb rate"
              data-testid="vsi-increase-rate-btn"
              onClick={() => handleStepSpeed(250)}
              className="flex-1 py-1 px-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold flex items-center justify-center gap-1 transition"
            >
              <ChevronUp className="w-3.5 h-3.5" /> +250
            </button>
            <button
              type="button"
              aria-label="Decrease climb rate"
              data-testid="vsi-decrease-rate-btn"
              onClick={() => handleStepSpeed(-250)}
              className="flex-1 py-1 px-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold flex items-center justify-center gap-1 transition"
            >
              <ChevronDown className="w-3.5 h-3.5" /> -250
            </button>
            <button
              type="button"
              aria-label="Level out vertical speed"
              data-testid="vsi-level-rate-btn"
              onClick={() => {
                setSimulatedFpm(0);
                onVerticalSpeedChange?.(0);
              }}
              className="py-1 px-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-bold transition"
            >
              0
            </button>
          </div>
        </div>

        {/* Right Column: Avionics Vertical Speed Tape Scale */}
        <div
          data-testid="vsi-tape-scale"
          className="relative w-24 h-56 bg-black/70 rounded-xl border border-emerald-500/40 overflow-hidden shadow-inner flex items-center justify-end"
        >
          {/* Top/bottom gradient vignettes */}
          <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-black via-black/80 to-transparent pointer-events-none z-10" />
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-10" />

          {/* Symmetrical Tape Scale Ticks */}
          <div className="absolute inset-0 flex flex-col justify-between py-2.5 pr-1.5">
            {tapeMarkings.map((mark) => (
              <div
                key={mark.fpm}
                data-testid={`vsi-mark-${mark.fpm}`}
                className="w-full flex items-center justify-end pr-1 relative h-2.5"
              >
                {mark.isMajor ? (
                  <div className="flex items-center gap-1.5">
                    {mark.label && (
                      <span
                        className={`text-[9px] font-mono font-bold tracking-tighter ${
                          mark.fpm === 0
                            ? "text-white"
                            : mark.fpm > 0
                              ? "text-emerald-400"
                              : "text-cyan-400"
                        }`}
                      >
                        {mark.label}
                      </span>
                    )}
                    <span
                      className={`h-[2px] ${
                        mark.fpm === 0
                          ? "w-4 bg-white shadow-[0_0_6px_#ffffff]"
                          : "w-3 bg-emerald-400 shadow-[0_0_4px_#10b981]"
                      }`}
                    />
                  </div>
                ) : (
                  <span className="w-1.5 h-[1px] bg-emerald-500/50" />
                )}
              </div>
            ))}
          </div>

          {/* Dynamic Rate Ribbon Bar (extends from 0 center line up or down) */}
          <div
            data-testid="vsi-rate-ribbon"
            className={`absolute right-1 w-1.5 transition-all duration-300 ease-out z-15 ${
              simulatedFpm >= 0
                ? "bg-gradient-to-t from-emerald-500 via-emerald-400 to-cyan-300 shadow-[0_0_8px_#10b981]"
                : "bg-gradient-to-b from-cyan-500 via-blue-500 to-rose-400 shadow-[0_0_8px_#06b6d4]"
            }`}
            style={{
              top: simulatedFpm >= 0 ? `${112 + needleOffsetPx}px` : "112px",
              height: `${Math.abs(needleOffsetPx)}px`,
            }}
          />

          {/* Center Zero Benchmark Reticle */}
          <div className="absolute left-1 right-0 top-1/2 -translate-y-1/2 z-10 flex items-center pointer-events-none opacity-80">
            <span className="w-full border-t border-dashed border-emerald-500/40" />
          </div>

          {/* Selected VS Target Bug (if set) */}
          {selectedVsBugFpm !== 0 && (
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 z-25 transition-transform duration-300 pointer-events-none"
              style={{
                transform: `translateY(${bugOffsetPx}px)`,
              }}
            >
              <div className="w-2.5 h-3 border-y-2 border-r-2 border-cyan-400 bg-cyan-500/20 shadow-[0_0_6px_#06b6d4]" />
            </div>
          )}

          {/* Dynamic VSI Needle Pointer (moving chevron with readout bug) */}
          <div
            data-testid="vsi-needle-pointer"
            className="absolute left-0 right-0 top-1/2 -translate-y-1/2 z-30 flex items-center pointer-events-none transition-transform duration-200 ease-out"
            style={{
              transform: `translateY(${needleOffsetPx}px)`,
            }}
          >
            {/* Pointer arrow chevron */}
            <div
              className={`w-0 h-0 border-y-[5px] border-y-transparent border-l-[7px] ${
                simulatedFpm > 0
                  ? "border-l-emerald-400 drop-shadow-[0_0_6px_#10b981]"
                  : simulatedFpm < 0
                    ? "border-l-cyan-400 drop-shadow-[0_0_6px_#06b6d4]"
                    : "border-l-white drop-shadow-[0_0_6px_#ffffff]"
              }`}
            />
            {/* Horizontal pointer line reaching the scale */}
            <div
              className={`flex-1 h-[2px] ${
                simulatedFpm > 0
                  ? "bg-emerald-400"
                  : simulatedFpm < 0
                    ? "bg-cyan-400"
                    : "bg-white"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Footer Mode & Target Floor Stepper */}
      <div className="pt-2 border-t border-emerald-500/15 flex items-center justify-between text-[10px] text-zinc-400 font-mono">
        <div className="flex items-center gap-1">
          <Zap className="w-3 h-3 text-emerald-400" />
          <span data-testid="vsi-transit-mode-name" className="text-zinc-300">
            {(TRANSIT_MODE_PROFILES[transitMode] || TRANSIT_MODE_PROFILES.elevator_local).name}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Increase target floor"
            data-testid="vsi-target-floor-up-btn"
            onClick={() => handleFloorChange(targetFloor + 1)}
            disabled={targetFloor >= totalFloors}
            className="p-0.5 rounded bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30"
          >
            <ChevronUp className="w-3 h-3 text-emerald-300" />
          </button>
          <span className="text-emerald-400 font-bold">F{targetFloor}</span>
          <button
            type="button"
            aria-label="Decrease target floor"
            data-testid="vsi-target-floor-down-btn"
            onClick={() => handleFloorChange(targetFloor - 1)}
            disabled={targetFloor <= 1}
            className="p-0.5 rounded bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30"
          >
            <ChevronDown className="w-3 h-3 text-emerald-300" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default CockpitVerticalSpeedTape;
