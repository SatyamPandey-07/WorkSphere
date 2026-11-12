"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  Compass,
  Navigation,
  ShieldAlert,
  RotateCcw,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Eye,
  Crosshair,
} from "lucide-react";
import {
  useFlightAttitudeTracker,
  type FlightAttitude,
  type UseFlightAttitudeTrackerOptions,
} from "@/hooks/useFlightAttitudeTracker";

export interface AttitudeHorizonIndicatorProps {
  /** Explicit pitch override in degrees (-90 to +90). If omitted, uses live tracker. */
  pitch?: number;
  /** Explicit roll override in degrees (-180 to +180). If omitted, uses live tracker. */
  roll?: number;
  /** Explicit yaw / heading override in degrees (0 to 360). If omitted, uses live tracker. */
  yaw?: number;
  /** Target waypoint pitch for vertical AR guidance (e.g. +8° upstairs, -10° downstairs). */
  targetPitch?: number;
  /** Target waypoint compass heading for horizontal AR guidance (0 to 360°). */
  targetHeading?: number;
  /** Target destination name for AR guidance (e.g. "Desk 42B", "Quiet Pod 03", "Stairs to Fl 4"). */
  targetLabel?: string;
  /** Complementary filter options forwarded to useFlightAttitudeTracker */
  trackerOptions?: UseFlightAttitudeTrackerOptions;
  /** Pixel diameter of the attitude indicator gauge (default: 320) */
  size?: number;
  /** Sensitivity scale: pixels of vertical translation per degree of pitch (default: 3.2) */
  pixelsPerDegree?: number;
  /** Whether to show numeric telemetry readouts (default: true) */
  showTelemetry?: boolean;
  /** Whether to show developer simulation tilt controls (default: true) */
  showSimControls?: boolean;
  /** Custom wrapper styling */
  className?: string;
}

/**
 * Calculates vertical pixel displacement of the artificial horizon based on pitch.
 * Positive pitch (nose-up) moves the horizon down; negative pitch (nose-down) moves it up.
 */
export function calculateHorizonTranslation(
  pitch: number,
  pixelsPerDegree = 3.2,
  maxTranslationPx = 140,
): number {
  const safePitch = typeof pitch === "number" && Number.isFinite(pitch) ? pitch : 0;
  const safePpd =
    typeof pixelsPerDegree === "number" && Number.isFinite(pixelsPerDegree) && pixelsPerDegree > 0
      ? pixelsPerDegree
      : 3.2;
  const safeMax =
    typeof maxTranslationPx === "number" && Number.isFinite(maxTranslationPx) && maxTranslationPx > 0
      ? maxTranslationPx
      : 140;

  const clampedPitch = Math.max(-90, Math.min(90, safePitch));
  const translation = clampedPitch * safePpd;
  const clamped = Math.max(-safeMax, Math.min(safeMax, translation));
  return clamped === 0 ? 0 : clamped;
}

/**
 * Calculates roll rotation in degrees for CSS transform.
 * Clockwise device bank requires counter-clockwise horizon rotation.
 */
export function calculateRollRotation(roll: number): number {
  const safeRoll = typeof roll === "number" && Number.isFinite(roll) ? roll : 0;
  const rotated = -safeRoll;
  return rotated === 0 ? 0 : rotated;
}

/**
 * Determines whether the device attitude is sufficiently level for AR planar scanning.
 */
export function isAttitudeLevel(
  pitch: number,
  roll: number,
  toleranceDeg = 8,
): boolean {
  const safePitch = typeof pitch === "number" && Number.isFinite(pitch) ? pitch : 0;
  const safeRoll = typeof roll === "number" && Number.isFinite(roll) ? roll : 0;
  const safeTol =
    typeof toleranceDeg === "number" && Number.isFinite(toleranceDeg) && toleranceDeg >= 0
      ? toleranceDeg
      : 8;

  return Math.abs(safePitch) <= safeTol && Math.abs(safeRoll) <= safeTol;
}

/**
 * Calculates steering error between current attitude and target AR venue waypoint.
 */
export function calculateFlightDirectorOffset(
  currentPitch: number,
  targetPitch: number,
  currentYaw: number,
  targetYaw: number,
): { pitchError: number; yawError: number; isAligned: boolean } {
  const safeCurrentPitch =
    typeof currentPitch === "number" && Number.isFinite(currentPitch) ? currentPitch : 0;
  const safeTargetPitch =
    typeof targetPitch === "number" && Number.isFinite(targetPitch) ? targetPitch : 0;
  const safeCurrentYaw =
    typeof currentYaw === "number" && Number.isFinite(currentYaw)
      ? ((currentYaw % 360) + 360) % 360
      : 0;
  const safeTargetYaw =
    typeof targetYaw === "number" && Number.isFinite(targetYaw)
      ? ((targetYaw % 360) + 360) % 360
      : 0;

  const pitchError = safeTargetPitch - safeCurrentPitch;

  // Shortest angular distance on circular compass
  const yawError = (safeTargetYaw - safeCurrentYaw + 540) % 360 - 180;

  const isAligned = Math.abs(pitchError) <= 4 && Math.abs(yawError) <= 6;

  return { pitchError, yawError, isAligned };
}

/**
 * AttitudeHorizonIndicator
 *
 * Military-grade primary flight display (PFD) artificial horizon instrument for AR venue guidance.
 * Driven by smoothed accelerometer + gyroscope + magnetometer sensor fusion from useFlightAttitudeTracker.
 *
 * Features:
 *  1. Rotating & translating artificial horizon sphere (Sky azure / Ground charcoal)
 *  2. Graduated pitch ladder with horizon-pointing ticks (+30° to -30°)
 *  3. Fixed aircraft reference boresight wings with center crosshair
 *  4. Roll angle arc with calibrated pointer triangle (0°, ±10°, ±20°, ±30°, ±45°, ±60°)
 *  5. AR venue waypoint flight director cue (elevation & heading vector steering)
 *  6. Level Horizon alert for optimal AR camera camera pose & surface recognition
 */
export function AttitudeHorizonIndicator({
  pitch: propPitch,
  roll: propRoll,
  yaw: propYaw,
  targetPitch,
  targetHeading,
  targetLabel = "Target Waypoint",
  trackerOptions,
  size = 320,
  pixelsPerDegree = 3.2,
  showTelemetry = true,
  showSimControls = true,
  className = "",
}: AttitudeHorizonIndicatorProps) {
  // Hook into complementary filter fusion tracker
  const tracker = useFlightAttitudeTracker(trackerOptions);

  // Manual interactive simulation state for desktop dev / testing
  const [simPitch, setSimPitch] = useState<number | null>(null);
  const [simRoll, setSimRoll] = useState<number | null>(null);
  const [simYaw, setSimYaw] = useState<number | null>(null);

  const safeSize = typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 320;
  const safePixelsPerDegree =
    typeof pixelsPerDegree === "number" && Number.isFinite(pixelsPerDegree) && pixelsPerDegree > 0
      ? pixelsPerDegree
      : 3.2;

  // Effective attitude resolution: manual sim > prop override > sensor fusion tracker > nominal zero
  const attitude: FlightAttitude = useMemo(() => {
    const rawPitch =
      simPitch ??
      (typeof propPitch === "number" && Number.isFinite(propPitch) ? propPitch : undefined) ??
      tracker.attitude?.pitch ??
      0;
    const rawRoll =
      simRoll ??
      (typeof propRoll === "number" && Number.isFinite(propRoll) ? propRoll : undefined) ??
      tracker.attitude?.roll ??
      0;
    const rawYaw =
      simYaw ??
      (typeof propYaw === "number" && Number.isFinite(propYaw) ? propYaw : undefined) ??
      tracker.attitude?.yaw ??
      0;

    return {
      pitch: Number.isFinite(rawPitch) ? rawPitch : 0,
      roll: Number.isFinite(rawRoll) ? rawRoll : 0,
      yaw: Number.isFinite(rawYaw) ? ((rawYaw % 360) + 360) % 360 : 0,
    };
  }, [simPitch, simRoll, simYaw, propPitch, propRoll, propYaw, tracker.attitude]);

  const { pitch, roll, yaw } = attitude;

  const maxTranslation = (safeSize / 2) * 0.85;
  const horizonTranslateY = calculateHorizonTranslation(
    pitch,
    safePixelsPerDegree,
    maxTranslation,
  );
  const rollRotationDeg = calculateRollRotation(roll);
  const isLevel = isAttitudeLevel(pitch, roll);

  // AR Flight Director waypoint alignment
  const flightDirector = useMemo(() => {
    if (
      targetPitch === undefined ||
      targetHeading === undefined ||
      !Number.isFinite(targetPitch) ||
      !Number.isFinite(targetHeading)
    ) {
      return null;
    }
    return calculateFlightDirectorOffset(pitch, targetPitch, yaw, targetHeading);
  }, [pitch, targetPitch, yaw, targetHeading]);

  // Handle resetting manual simulation
  const handleResetSimulation = useCallback(() => {
    setSimPitch(null);
    setSimRoll(null);
    setSimYaw(null);
  }, []);

  const ladderRungs = [-30, -20, -10, 10, 20, 30];

  return (
    <div
      role="region"
      aria-label="Attitude Horizon Indicator Instrument"
      data-testid="attitude-horizon-indicator"
      className={`relative flex flex-col items-center justify-center p-5 rounded-3xl bg-zinc-950/95 border-2 border-emerald-500/40 text-emerald-400 font-mono shadow-2xl shadow-emerald-950/60 backdrop-blur-md select-none w-full max-w-md mx-auto ${className}`}
    >
      {/* Header Banner */}
      <div className="w-full flex items-center justify-between pb-3 mb-3 border-b border-emerald-500/30 text-xs">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-white uppercase tracking-wider text-[11px]">
            ADI // AR FLIGHT HORIZON
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span
            className={`w-2 h-2 rounded-full ${
              tracker.isTracking
                ? "bg-emerald-400 animate-pulse"
                : "bg-amber-400"
            }`}
          />
          <span className="text-zinc-400">
            {tracker.isTracking ? "GYRO FIX" : "STANDBY"}
          </span>
        </div>
      </div>

      {/* Primary Circular Instrument Bezel */}
      <div
        className="relative rounded-full border-4 border-zinc-800 shadow-[inset_0_0_25px_rgba(0,0,0,0.9),0_0_20px_rgba(16,185,129,0.2)] overflow-hidden flex items-center justify-center bg-black"
        style={{ width: safeSize, height: safeSize }}
      >
        {/* Dynamic Artificial Horizon Disc (Moves with Pitch & Roll) */}
        <div
          data-testid="horizon-disc"
          className="absolute w-[240%] h-[240%] transition-transform duration-75 ease-out origin-center pointer-events-none"
          style={{
            transform: `rotate(${rollRotationDeg}deg) translateY(${horizonTranslateY}px)`,
          }}
        >
          {/* Top Half: Sky (Tactical Deep Blue-Cyan Gradient) */}
          <div className="w-full h-1/2 bg-gradient-to-t from-sky-900/90 to-cyan-950/80 border-b-2 border-emerald-400 relative">
            {/* Horizon Sky Glow */}
            <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-emerald-400/20 to-transparent" />
          </div>

          {/* Bottom Half: Ground / Earth (Dark Earth Charcoal Gradient) */}
          <div className="w-full h-1/2 bg-gradient-to-b from-stone-900 to-zinc-950 relative">
            {/* Horizon Ground Shading */}
            <div className="absolute top-0 inset-x-0 h-8 bg-gradient-to-b from-emerald-950/40 to-transparent" />
          </div>

          {/* Pitch Ladder Rungs Superimposed on Horizon Card */}
          <div
            data-testid="pitch-ladder"
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          >
            {ladderRungs.map((deg) => {
              const rungY = -deg * safePixelsPerDegree;
              const isNoseUp = deg > 0;
              const rungWidth = Math.abs(deg) === 30 ? 76 : Math.abs(deg) === 20 ? 60 : 44;

              return (
                <div
                  key={deg}
                  className="absolute flex items-center justify-center"
                  style={{ transform: `translateY(${rungY}px)` }}
                >
                  <span className="text-[9px] font-mono font-bold text-emerald-400/80 mr-1.5">
                    {deg > 0 ? `+${deg}` : `${deg}`}
                  </span>
                  <div
                    className={`h-[2px] flex items-center justify-between ${
                      isNoseUp
                        ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.8)]"
                        : "border-b border-dashed border-emerald-400/80"
                    }`}
                    style={{ width: rungWidth }}
                  >
                    {/* Tick Mark pointing toward the horizon */}
                    <div
                      className={`w-[2px] h-2 bg-emerald-400 ${
                        isNoseUp ? "mt-2" : "-mt-2"
                      }`}
                    />
                    <div
                      className={`w-[2px] h-2 bg-emerald-400 ${
                        isNoseUp ? "mt-2" : "-mt-2"
                      }`}
                    />
                  </div>
                  <span className="text-[9px] font-mono font-bold text-emerald-400/80 ml-1.5">
                    {deg > 0 ? `+${deg}` : `${deg}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Circular Roll Scale Arc Around Outer Perimeter */}
        <div
          data-testid="roll-scale-arc"
          className="absolute inset-0 pointer-events-none"
        >
          {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((deg) => {
            const isZero = deg === 0;
            const isMajor = Math.abs(deg) === 30 || Math.abs(deg) === 60;
            return (
              <div
                key={deg}
                className="absolute inset-0 flex items-start justify-center"
                style={{ transform: `rotate(${deg}deg)` }}
              >
                <div
                  className={`mt-1.5 ${
                    isZero
                      ? "w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[8px] border-t-amber-400"
                      : isMajor
                      ? "w-1 h-3 bg-emerald-400"
                      : "w-0.5 h-2 bg-emerald-500/70"
                  }`}
                />
              </div>
            );
          })}
        </div>

        {/* Dynamic Roll Pointer Triangle (moves with roll at top of arc) */}
        <div
          data-testid="roll-pointer"
          className="absolute inset-0 pointer-events-none transition-transform duration-75 ease-out"
          style={{ transform: `rotate(${rollRotationDeg}deg)` }}
        >
          <div className="w-full flex justify-center pt-3">
            <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[9px] border-b-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)]" />
          </div>
        </div>

        {/* Fixed Aircraft Boresight Reference Symbol (Wings + Center Pip) */}
        <div
          data-testid="aircraft-reference-symbol"
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
        >
          {/* Left Wing */}
          <div className="w-14 h-1.5 bg-amber-400 border border-black shadow-[0_0_6px_rgba(251,191,36,0.9)] rounded-l-sm" />
          {/* Center Pip / Dot */}
          <div className="w-3.5 h-3.5 rounded-full border-2 border-black bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,1)] mx-2" />
          {/* Right Wing */}
          <div className="w-14 h-1.5 bg-amber-400 border border-black shadow-[0_0_6px_rgba(251,191,36,0.9)] rounded-r-sm" />
        </div>

        {/* AR Waypoint Flight Director Cue (If Target Vector is supplied) */}
        {flightDirector && (
          <div
            data-testid="flight-director-cue"
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
            style={{
              transform: `translate(${Math.max(
                -90,
                Math.min(90, flightDirector.yawError * 2.5),
              )}px, ${Math.max(
                -90,
                Math.min(90, -flightDirector.pitchError * safePixelsPerDegree),
              )}px)`,
            }}
          >
            <div
              className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
                flightDirector.isAligned
                  ? "border-emerald-300 bg-emerald-500/30 shadow-[0_0_15px_#10b981] animate-ping"
                  : "border-cyan-400 bg-cyan-950/40 shadow-[0_0_10px_#22d3ee]"
              }`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  flightDirector.isAligned ? "bg-white" : "bg-cyan-300"
                }`}
              />
            </div>
          </div>
        )}

        {/* Central Bezel Crosshairs */}
        <div className="absolute inset-x-0 h-[1px] bg-emerald-500/20 pointer-events-none" />
        <div className="absolute inset-y-0 w-[1px] bg-emerald-500/20 pointer-events-none" />
      </div>

      {/* AR Navigation Cue / Level Scan Status Banner */}
      <div
        data-testid="ar-guidance-banner"
        className={`w-full mt-4 p-2.5 rounded-xl border text-center text-xs font-mono transition-all ${
          flightDirector?.isAligned
            ? "bg-emerald-950/90 border-emerald-400 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.3)] animate-pulse"
            : !isLevel
            ? "bg-amber-950/80 border-amber-500/60 text-amber-300"
            : "bg-zinc-900/80 border-emerald-500/30 text-emerald-400"
        }`}
      >
        <div className="flex items-center justify-center gap-1.5 font-bold">
          {flightDirector ? (
            flightDirector.isAligned ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>ON VECTOR // {targetLabel.toUpperCase()} LOCKED</span>
              </>
            ) : (
              <>
                <Navigation className="w-4 h-4 text-cyan-400 animate-pulse" />
                <span>
                  STEER VECTOR: {flightDirector.yawError > 0 ? "RIGHT" : "LEFT"}{" "}
                  {Math.abs(Math.round(flightDirector.yawError))}° ·{" "}
                  {flightDirector.pitchError > 0 ? "TILT UP" : "TILT DOWN"}{" "}
                  {Math.abs(Math.round(flightDirector.pitchError))}°
                </span>
              </>
            )
          ) : isLevel ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>HORIZON LEVEL // AR SCANNER OPTIMAL</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <span>LEVEL CAMERA FOR ACCURATE AR POSE</span>
            </>
          )}
        </div>
      </div>

      {/* Numeric Flight Telemetry Readouts */}
      {showTelemetry && (
        <div className="grid grid-cols-3 gap-2 w-full mt-3 text-center text-xs font-mono">
          <div className="p-2 rounded-xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[10px] text-zinc-500 font-semibold">PITCH</div>
            <div
              data-testid="attitude-pitch-telemetry"
              className={`font-black ${
                Math.abs(pitch) > 30 ? "text-amber-400" : "text-white"
              }`}
            >
              {pitch >= 0 ? `+${pitch.toFixed(1)}°` : `${pitch.toFixed(1)}°`}
            </div>
          </div>
          <div className="p-2 rounded-xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[10px] text-zinc-500 font-semibold">ROLL</div>
            <div
              data-testid="attitude-roll-telemetry"
              className={`font-black ${
                Math.abs(roll) > 25 ? "text-amber-400" : "text-white"
              }`}
            >
              {roll >= 0 ? `+${roll.toFixed(1)}°` : `${roll.toFixed(1)}°`}
            </div>
          </div>
          <div className="p-2 rounded-xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[10px] text-zinc-500 font-semibold">YAW / HDG</div>
            <div
              data-testid="attitude-yaw-telemetry"
              className="font-black text-cyan-300"
            >
              {Math.round(yaw).toString().padStart(3, "0")}°
            </div>
          </div>
        </div>
      )}

      {/* Permission Button for iOS Safari / Motion Gating */}
      {tracker.permissionState === "prompt" && (
        <button
          type="button"
          data-testid="request-attitude-permission-btn"
          onClick={() => tracker.requestPermission()}
          className="mt-3 w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition"
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Enable Device Gyro &amp; Motion Sensors</span>
        </button>
      )}

      {/* Simulation Controls for Dev / Testing */}
      {showSimControls && (
        <div className="mt-4 pt-3 border-t border-emerald-500/20 w-full text-[11px]">
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span>FLIGHT SIMULATOR CONTROLS:</span>
            {(simPitch !== null || simRoll !== null || simYaw !== null) && (
              <button
                type="button"
                data-testid="simulate-level-btn"
                onClick={handleResetSimulation}
                className="text-amber-400 hover:underline flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Live</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              data-testid="simulate-pitch-up-btn"
              onClick={() => setSimPitch((p) => (p ?? pitch) + 10)}
              className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-emerald-300 text-[10px] font-semibold"
            >
              Pitch +10°
            </button>
            <button
              type="button"
              data-testid="simulate-pitch-down-btn"
              onClick={() => setSimPitch((p) => (p ?? pitch) - 10)}
              className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-emerald-300 text-[10px] font-semibold"
            >
              Pitch -10°
            </button>
            <button
              type="button"
              data-testid="simulate-roll-left-btn"
              onClick={() => setSimRoll((r) => (r ?? roll) - 15)}
              className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-emerald-300 text-[10px] font-semibold"
            >
              Bank L 15°
            </button>
            <button
              type="button"
              data-testid="simulate-roll-right-btn"
              onClick={() => setSimRoll((r) => (r ?? roll) + 15)}
              className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-emerald-300 text-[10px] font-semibold"
            >
              Bank R 15°
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AttitudeHorizonIndicator;
