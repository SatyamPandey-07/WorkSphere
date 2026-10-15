"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Gauge, Fuel, AlertTriangle, Droplets, Coffee, BatteryCharging } from "lucide-react";
import { useBatteryStatus } from "@/hooks/useBatteryStatus";

export const BINGO_FUEL_THRESHOLD = 15; // 15%
export const MAX_JP8_CAPACITY_LBS = 8000; // 8,000 lbs standard jet fuel load
export const BASE_BURN_RATE_LBS_PER_HOUR = 1200; // 1,200 lbs/hr cruise burn

export interface FuelEnduranceInputs {
  /** Continuous focus minutes worked since last operational rest cycle */
  minutesWorked: number;
  /** Minutes elapsed since last recorded hydration event */
  minutesSinceHydration: number;
  /** Battery charge ratio (0.0 to 1.0) */
  batteryLevel?: number | null;
  /** Custom baseline burn rate in lbs/hr */
  baseBurnRate?: number;
}

export interface FuelCalculationResult {
  totalFuelPercent: number;
  totalFuelLbs: number;
  burnRateLbsPerHour: number;
  estimatedEnduranceMinutes: number;
  isBingoFuel: boolean;
  leftTankPercent: number;
  rightTankPercent: number;
}

/**
 * Calculates simulated JP-8 tactical fuel reserves and endurance burn rate.
 */
export function calculateFuelEndurance({
  minutesWorked,
  minutesSinceHydration,
  batteryLevel = null,
  baseBurnRate = BASE_BURN_RATE_LBS_PER_HOUR,
}: FuelEnduranceInputs): FuelCalculationResult {
  // Fatigue drain: 4 hours continuous work drains 50% capacity
  const workDrain = (Math.max(0, minutesWorked) / 240) * 50;

  // Hydration drain: 2 hours without hydration drains 30% capacity
  const hydrationDrain = (Math.max(0, minutesSinceHydration) / 120) * 30;

  // Battery penalty: low battery adds urgency drain
  let batteryDrain = 0;
  if (batteryLevel !== null && batteryLevel !== undefined) {
    const normBatt = batteryLevel <= 1 ? batteryLevel : batteryLevel / 100;
    if (normBatt < 0.2) {
      batteryDrain = (0.2 - normBatt) * 50; // up to 10% penalty
    }
  }

  const rawPercent = 100 - (workDrain + hydrationDrain + batteryDrain);
  const totalFuelPercent = Math.max(0, Math.min(100, Math.round(rawPercent * 10) / 10));
  const totalFuelLbs = Math.round((totalFuelPercent / 100) * MAX_JP8_CAPACITY_LBS);

  // Dynamic burn rate acceleration based on fatigue and dehydration
  const fatigueMultiplier = 1 + (Math.max(0, minutesWorked) / 180) * 0.5;
  const hydrationMultiplier = 1 + (Math.max(0, minutesSinceHydration) / 90) * 0.4;
  const burnRateLbsPerHour = Math.round(baseBurnRate * fatigueMultiplier * hydrationMultiplier);

  const estimatedEnduranceMinutes =
    burnRateLbsPerHour > 0
      ? Math.max(0, Math.round((totalFuelLbs / burnRateLbsPerHour) * 60))
      : 0;

  const isBingoFuel = totalFuelPercent <= BINGO_FUEL_THRESHOLD;

  // Twin tank fuel distribution (slight balance variance for avionics realism)
  const leftTankPercent = Math.max(0, Math.min(100, Math.round((totalFuelPercent + 0.4) * 10) / 10));
  const rightTankPercent = Math.max(0, Math.min(100, Math.round((totalFuelPercent - 0.4) * 10) / 10));

  return {
    totalFuelPercent,
    totalFuelLbs,
    burnRateLbsPerHour,
    estimatedEnduranceMinutes,
    isBingoFuel,
    leftTankPercent,
    rightTankPercent,
  };
}

/**
 * Procedurally generates the military cockpit Bingo Fuel audio caution horn.
 */
function playBingoFuelAudioAlert() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return;
    const ctx = new AudioCtxClass();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    // Pulsing 850Hz to 650Hz dual caution tone
    osc.frequency.setValueAtTime(850, now);
    osc.frequency.setValueAtTime(650, now + 0.12);
    osc.frequency.setValueAtTime(850, now + 0.24);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
  } catch {
    // Ignore audio permission or context restrictions
  }
}

export interface FuelReserveGaugeProps {
  /** Focus time in minutes (defaults to local session tracker) */
  minutesWorked?: number;
  /** Hydration time in minutes */
  minutesSinceHydration?: number;
  /** Explicit laptop battery level override (0.0 to 1.0) */
  batteryLevel?: number | null;
  /** Enable audio alarm on Bingo Fuel threshold transition (default: true) */
  enableAudioAlert?: boolean;
  /** Refuel callback when user drinks water */
  onHydrateRefuel?: () => void;
  /** Refuel callback when user takes rest break */
  onBreakRefuel?: () => void;
  /** Custom wrapper styling */
  className?: string;
}

/**
 * FuelReserveGauge: Fighter Jet JP-8 Internal Fuel & Work Endurance Monitor (#6308).
 * Features twin analog vertical fuel tapes, real-time burn rate telemetry,
 * and audio/visual BINGO FUEL // RETURN TO BASE critical low endurance warnings.
 */
export function FuelReserveGauge({
  minutesWorked: propMinutesWorked,
  minutesSinceHydration: propMinutesHydration,
  batteryLevel: propBatteryLevel,
  enableAudioAlert = true,
  onHydrateRefuel,
  onBreakRefuel,
  className = "",
}: FuelReserveGaugeProps) {
  const batteryState = useBatteryStatus();

  // Internal simulated timer states if props are omitted
  const [internalMinutesWorked, setInternalMinutesWorked] = useState(45);
  const [internalMinutesHydration, setInternalMinutesHydration] = useState(30);

  const minutesWorked = propMinutesWorked !== undefined ? propMinutesWorked : internalMinutesWorked;
  const minutesSinceHydration =
    propMinutesHydration !== undefined ? propMinutesHydration : internalMinutesHydration;

  const batteryLevel =
    propBatteryLevel !== undefined
      ? propBatteryLevel
      : batteryState.level !== null
      ? batteryState.level
      : null;

  const fuelTelemetry = useMemo(() => {
    return calculateFuelEndurance({
      minutesWorked,
      minutesSinceHydration,
      batteryLevel,
    });
  }, [minutesWorked, minutesSinceHydration, batteryLevel]);

  // Track Bingo Fuel state transition for audio alert
  const prevBingoRef = useRef(fuelTelemetry.isBingoFuel);
  useEffect(() => {
    if (!prevBingoRef.current && fuelTelemetry.isBingoFuel) {
      if (enableAudioAlert) {
        playBingoFuelAudioAlert();
      }
    }
    prevBingoRef.current = fuelTelemetry.isBingoFuel;
  }, [fuelTelemetry.isBingoFuel, enableAudioAlert]);

  const handleDrinkWater = useCallback(() => {
    setInternalMinutesHydration(0);
    onHydrateRefuel?.();
  }, [onHydrateRefuel]);

  const handleTakeBreak = useCallback(() => {
    setInternalMinutesWorked(0);
    setInternalMinutesHydration(0);
    onBreakRefuel?.();
  }, [onBreakRefuel]);

  const getTapeColor = (percent: number) => {
    if (percent <= BINGO_FUEL_THRESHOLD) return "bg-red-500 shadow-[0_0_10px_#ef4444]";
    if (percent <= 30) return "bg-amber-400 shadow-[0_0_8px_#f59e0b]";
    return "bg-emerald-400 shadow-[0_0_8px_#10b981]";
  };

  return (
    <div
      role="region"
      aria-label="Fighter Jet JP-8 Fuel Reserve Gauge"
      className={`p-4 rounded-2xl bg-[#03110b]/90 dark:bg-zinc-950/95 border border-emerald-500/30 shadow-2xl shadow-emerald-950/50 text-emerald-400 font-mono backdrop-blur-md w-full max-w-[340px] select-none ${className}`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2 mb-3">
        <div className="flex items-center gap-2">
          <Fuel className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            JP-8 FUEL QTY
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <span>BURN</span>
          <span className="font-bold text-emerald-300">
            {fuelTelemetry.burnRateLbsPerHour} LBS/HR
          </span>
        </div>
      </div>

      {/* Bingo Fuel Critical Alert Banner */}
      {fuelTelemetry.isBingoFuel && (
        <div
          data-testid="bingo-fuel-alert"
          role="alert"
          className="mb-3 p-2 rounded-lg bg-red-950/80 border-2 border-red-500 text-red-400 text-xs font-bold tracking-wider text-center flex items-center justify-center gap-2 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.5)]"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>BINGO FUEL // RETURN TO BASE</span>
        </div>
      )}

      {/* Main Dual Tape Analog Display */}
      <div className="flex items-center justify-between gap-4 py-2">
        {/* Left Tape: Tank L (Stamina / Focus) */}
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <span className="text-[10px] font-bold text-zinc-400">L TANK</span>
          <div className="relative w-8 h-40 bg-zinc-950/80 rounded-lg border border-emerald-500/30 overflow-hidden flex flex-col justify-end p-1">
            {/* Tick marks */}
            <div className="absolute inset-0 flex flex-col justify-between py-1 px-1 pointer-events-none opacity-40">
              <span className="w-full border-b border-emerald-400/60" />
              <span className="w-1/2 border-b border-emerald-400/40" />
              <span className="w-full border-b border-emerald-400/60" />
              <span className="w-1/2 border-b border-emerald-400/40" />
              <span className="w-full border-b border-red-500/80" />
            </div>

            {/* Analog fluid column */}
            <div
              data-testid="fuel-tape-left"
              style={{ height: `${fuelTelemetry.leftTankPercent}%` }}
              className={`w-full rounded transition-all duration-500 ${getTapeColor(
                fuelTelemetry.leftTankPercent
              )}`}
            />
          </div>
          <span className="text-xs font-bold text-white">
            {Math.round((fuelTelemetry.totalFuelLbs / 2) / 100) / 10}k
          </span>
        </div>

        {/* Center Telemetry Readout Drum */}
        <div className="flex flex-col items-center justify-center gap-2 px-2 text-center">
          <div className="text-[9px] uppercase tracking-widest text-zinc-400">
            Internal Total
          </div>
          <div
            data-testid="total-fuel-readout"
            className="text-2xl font-black text-white tracking-tight drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]"
          >
            {fuelTelemetry.totalFuelPercent}%
          </div>
          <div className="text-[10px] text-emerald-300 font-bold">
            {fuelTelemetry.totalFuelLbs.toLocaleString()} LBS
          </div>

          <div className="mt-1 p-1.5 rounded-md bg-zinc-900/80 border border-emerald-500/20 text-[10px] text-zinc-300">
            <div>EST TIME ON STATION</div>
            <div className="font-bold text-emerald-400 text-xs mt-0.5">
              ~{fuelTelemetry.estimatedEnduranceMinutes} MIN
            </div>
          </div>
        </div>

        {/* Right Tape: Tank R (Hydration / Energy) */}
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <span className="text-[10px] font-bold text-zinc-400">R TANK</span>
          <div className="relative w-8 h-40 bg-zinc-950/80 rounded-lg border border-emerald-500/30 overflow-hidden flex flex-col justify-end p-1">
            {/* Tick marks */}
            <div className="absolute inset-0 flex flex-col justify-between py-1 px-1 pointer-events-none opacity-40">
              <span className="w-full border-b border-emerald-400/60" />
              <span className="w-1/2 border-b border-emerald-400/40" />
              <span className="w-full border-b border-emerald-400/60" />
              <span className="w-1/2 border-b border-emerald-400/40" />
              <span className="w-full border-b border-red-500/80" />
            </div>

            {/* Analog fluid column */}
            <div
              data-testid="fuel-tape-right"
              style={{ height: `${fuelTelemetry.rightTankPercent}%` }}
              className={`w-full rounded transition-all duration-500 ${getTapeColor(
                fuelTelemetry.rightTankPercent
              )}`}
            />
          </div>
          <span className="text-xs font-bold text-white">
            {Math.round((fuelTelemetry.totalFuelLbs / 2) / 100) / 10}k
          </span>
        </div>
      </div>

      {/* Refuel Actions & Reminders */}
      <div className="mt-3 pt-3 border-t border-emerald-500/15 flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="refuel-water-btn"
          onClick={handleDrinkWater}
          className="flex-1 py-1.5 px-2 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 hover:text-white text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Droplets className="w-3.5 h-3.5 text-cyan-400" />
          <span>Hydrate +15%</span>
        </button>

        <button
          type="button"
          data-testid="refuel-break-btn"
          onClick={handleTakeBreak}
          className="flex-1 py-1.5 px-2 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 hover:text-white text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Coffee className="w-3.5 h-3.5 text-amber-400" />
          <span>Refuel RTB</span>
        </button>
      </div>
    </div>
  );
}

export default FuelReserveGauge;
