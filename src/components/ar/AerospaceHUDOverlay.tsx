"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  QuaternionOrientationFilter,
  normalizeQuaternion,
  type Quaternion,
} from "@/lib/spatial/quaternionOrientation";

export interface AerospaceHUDOverlayProps {
  heading?: number;
  pitch?: number;
  roll?: number;
  altitude?: number; // in meters
  floorLevel?: number;
  cameraPosition?: { x: number; y: number; z: number };
  session?: any;
  callsign?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * Extracts pitch and roll angles in degrees from a unit quaternion.
 * Uses trigonometric clamping to avoid gimbal lock singularities.
 */
export function quaternionToPitchRoll(q: Quaternion): {
  pitch: number;
  roll: number;
} {
  const normQ = normalizeQuaternion(q);
  const { x, y, z, w } = normQ;

  // Pitch (rotation around transverse axis): clamped between -90 and 90
  const sinPitch = Math.max(-1, Math.min(1, 2 * (w * x - y * z)));
  const pitchDeg = Math.asin(sinPitch) * (180 / Math.PI);

  // Roll (rotation around longitudinal axis): between -180 and 180
  const rollDeg =
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z)) * (180 / Math.PI);

  return { pitch: pitchDeg, roll: rollDeg };
}

/**
 * AerospaceHUDOverlay
 *
 * Full aerospace HUD overlay projected onto the camera view featuring:
 * 1. Top rolling compass heading tape (000° to 360°)
 * 2. Vertical rolling altitude / floor level tape on right edge
 * 3. Flight-Path Marker (FPM) vector and pitch ladder on canopy glass
 * 4. Quaternion SLERP sensor fusion eliminating gimbal lock flips
 */
export default function AerospaceHUDOverlay({
  heading: propHeading,
  pitch: propPitch,
  roll: propRoll,
  altitude: propAltitude,
  floorLevel: propFloorLevel,
  cameraPosition,
  callsign = "SECTOR 2814 // RAPTOR-01",
  className = "",
  "data-testid": testId = "aerospace-hud-overlay",
}: AerospaceHUDOverlayProps) {
  const [sensorHeading, setSensorHeading] = useState<number>(0);
  const [sensorPitch, setSensorPitch] = useState<number>(0);
  const [sensorRoll, setSensorRoll] = useState<number>(0);

  const orientationFilterRef = useRef<QuaternionOrientationFilter | null>(null);
  if (!orientationFilterRef.current) {
    orientationFilterRef.current = new QuaternionOrientationFilter(0.25);
  }

  // Device orientation sensor listener with Quaternion SLERP interpolation
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha === null || e.beta === null) return;

      const filter = orientationFilterRef.current;
      if (!filter) return;

      // Update orientation filter to eliminate gimbal lock singularity flips
      const smoothedHeading = filter.update(e.alpha, e.beta, e.gamma ?? 0);
      setSensorHeading(smoothedHeading);

      const curQ = filter.getCurrentQuaternion();
      if (curQ) {
        const { pitch, roll } = quaternionToPitchRoll(curQ);
        setSensorPitch(pitch);
        setSensorRoll(roll);
      }
    };

    window.addEventListener("deviceorientation", handleOrientation);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, []);

  // Compute final values (props take precedence for deterministic override)
  const currentHeading =
    propHeading !== undefined
      ? ((propHeading % 360) + 360) % 360
      : sensorHeading;
  const currentPitch = propPitch !== undefined ? propPitch : sensorPitch;
  const currentRoll = propRoll !== undefined ? propRoll : sensorRoll;

  const currentAltitude =
    propAltitude !== undefined
      ? propAltitude
      : cameraPosition?.y !== undefined
        ? cameraPosition.y
        : 1.5;

  const currentFloor =
    propFloorLevel !== undefined
      ? propFloorLevel
      : Math.max(1, Math.floor((currentAltitude + 1.2) / 3.0) + 1);

  // Compass heading tape elements (major labels every 30 deg, minor ticks every 10 deg)
  const headingTapeItems = useMemo(() => {
    const items: Array<{ deg: number; label: string; isMajor: boolean }> = [];
    // Repeat sequence from -360 to 720 to provide infinite continuous rolling
    for (let d = -360; d <= 720; d += 10) {
      const normDeg = ((d % 360) + 360) % 360;
      let label = "";
      let isMajor = false;

      if (normDeg === 0) {
        label = "N";
        isMajor = true;
      } else if (normDeg === 90) {
        label = "E";
        isMajor = true;
      } else if (normDeg === 180) {
        label = "S";
        isMajor = true;
      } else if (normDeg === 270) {
        label = "W";
        isMajor = true;
      } else if (normDeg % 30 === 0) {
        label = normDeg.toString().padStart(3, "0");
        isMajor = true;
      }

      items.push({ deg: d, label, isMajor });
    }
    return items;
  }, []);

  // Pixels per degree for top tape
  const PX_PER_DEG = 4;
  // Offset to center current heading under lubber line (item deg 0 corresponds to center of track)
  const headingTranslateX = -currentHeading * PX_PER_DEG;

  // Altitude tape elements (from -10m to +50m in 1m intervals)
  const altitudeTapeItems = useMemo(() => {
    const items: Array<{ alt: number; label: string; isMajor: boolean }> = [];
    for (let a = -5; a <= 25; a += 1) {
      items.push({
        alt: a,
        label: `${a >= 0 ? "+" : ""}${a}m`,
        isMajor: a % 2 === 0,
      });
    }
    return items;
  }, []);

  const PX_PER_METER = 24;
  const altitudeTranslateY = currentAltitude * PX_PER_METER;

  return (
    <div
      data-testid={testId}
      className={`absolute inset-0 pointer-events-none select-none overflow-hidden z-20 font-mono text-emerald-400 ${className}`}
    >
      {/* Aerospace F-22 Canopy Glass Vignette & Hard-Light Corner Framing */}
      <div className="absolute inset-2 sm:inset-4 border border-emerald-500/20 rounded-3xl pointer-events-none shadow-[inset_0_0_80px_rgba(16,185,129,0.06)]" />

      {/* Top Left & Right Canopy Brackets */}
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 flex flex-col gap-0.5 text-[10px] text-emerald-400/80">
        <div className="flex items-center gap-1.5 font-bold tracking-wider">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>HUD // {callsign}</span>
        </div>
        <div className="text-[9px] text-emerald-500/70">
          SENSOR FUSION: OK · SLERP 4D
        </div>
      </div>

      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 text-right text-[10px] text-emerald-400/80">
        <div className="font-bold">G-LOAD: +1.0G</div>
        <div className="text-[9px] text-emerald-500/70">
          FOV: 74° · CANOPY HUD
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 1. TOP ROLLING COMPASS HEADING TAPE (000° to 360°)           */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div
        data-testid="hud-compass-heading-tape"
        className="absolute top-2 sm:top-4 left-1/2 -translate-x-1/2 flex flex-col items-center z-30"
      >
        {/* Digital Heading Readout Badge & Caret */}
        <div className="flex items-center gap-1 px-2.5 py-0.5 rounded bg-slate-950/80 border border-emerald-400/80 text-xs font-bold text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.6)]">
          <span className="text-[10px] text-emerald-400">HDG</span>
          <span data-testid="hud-compass-value" className="text-emerald-300">
            {Math.round(currentHeading).toString().padStart(3, "0")}°
          </span>
        </div>

        {/* Center Lubber Line Pointer Triangle */}
        <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-emerald-400 drop-shadow-[0_0_6px_#34d399]" />

        {/* Rolling Compass Tape Viewport */}
        <div className="relative w-72 sm:w-96 h-12 overflow-hidden border-b border-emerald-500/40 bg-gradient-to-b from-transparent to-emerald-950/20 backdrop-blur-[2px]">
          {/* Tape Track */}
          <div
            data-testid="hud-compass-tape-track"
            className="absolute top-0 bottom-0 flex items-end transition-transform duration-75 ease-out"
            style={{
              left: "50%",
              transform: `translateX(${headingTranslateX}px)`,
            }}
          >
            {headingTapeItems.map((item, idx) => (
              <div
                key={`${item.deg}-${idx}`}
                className="absolute flex flex-col items-center"
                style={{
                  left: `${item.deg * PX_PER_DEG}px`,
                  width: "1px",
                }}
              >
                {/* Major Label (N, 030, 060, E, 120, etc.) */}
                {item.label && (
                  <span
                    className={`text-[9px] mb-1 font-bold select-none ${
                      item.label === "N"
                        ? "text-emerald-200 font-extrabold text-[11px]"
                        : "text-emerald-400/90"
                    }`}
                  >
                    {item.label}
                  </span>
                )}
                {/* Tick Mark */}
                <span
                  className={`w-[1.5px] ${
                    item.isMajor
                      ? "h-3.5 bg-emerald-400 shadow-[0_0_4px_#10b981]"
                      : "h-2 bg-emerald-500/60"
                  }`}
                />
              </div>
            ))}
          </div>

          {/* Left/Right Edge Gradient Fade Masks */}
          <div className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-[#02140f] to-transparent pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[#02140f] to-transparent pointer-events-none" />
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 2. VERTICAL ROLLING ELEVATION / ALTITUDE TAPE (RIGHT EDGE)   */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div
        data-testid="hud-elevation-altitude-tape"
        className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 flex items-center z-30"
      >
        {/* Digital Altitude Pointer Box */}
        <div className="flex flex-col items-end mr-1.5 px-2 py-1 rounded bg-slate-950/85 border border-emerald-400/80 shadow-[0_0_12px_rgba(16,185,129,0.5)]">
          <div className="flex items-center gap-1 text-xs font-bold text-emerald-300">
            <span className="text-[9px] text-emerald-400">ALT</span>
            <span data-testid="hud-altitude-value">
              {currentAltitude >= 0 ? "+" : ""}
              {currentAltitude.toFixed(1)}m
            </span>
          </div>
          <div
            data-testid="hud-floor-level-badge"
            className="text-[10px] font-bold text-emerald-400/90 tracking-wider"
          >
            FL {currentFloor.toString().padStart(2, "0")}
          </div>
        </div>

        {/* Altitude Caret Pointing Left */}
        <div className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[6px] border-r-emerald-400 drop-shadow-[0_0_6px_#34d399]" />

        {/* Rolling Altitude Tape Viewport */}
        <div className="relative w-14 h-64 overflow-hidden border-l border-emerald-500/40 bg-gradient-to-l from-transparent to-emerald-950/20 backdrop-blur-[2px]">
          {/* Tape Track */}
          <div
            data-testid="hud-altitude-tape-track"
            className="absolute left-0 right-0 transition-transform duration-75 ease-out"
            style={{
              top: "50%",
              transform: `translateY(${altitudeTranslateY}px)`,
            }}
          >
            {altitudeTapeItems.map((item, idx) => (
              <div
                key={`${item.alt}-${idx}`}
                className="absolute left-0 flex items-center"
                style={{
                  top: `${-item.alt * PX_PER_METER}px`,
                  height: "1px",
                }}
              >
                {/* Tick Mark */}
                <span
                  className={`h-[1.5px] ${
                    item.isMajor
                      ? "w-3 bg-emerald-400 shadow-[0_0_4px_#10b981]"
                      : "w-1.5 bg-emerald-500/60"
                  }`}
                />
                {/* Label */}
                {item.isMajor && (
                  <span className="ml-1 text-[9px] text-emerald-400/80 font-bold select-none">
                    {item.label}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Top/Bottom Edge Fade Masks */}
          <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#02140f] to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#02140f] to-transparent pointer-events-none" />
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 3. FLIGHT-PATH MARKER (FPM) & PITCH LADDER                   */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Pitch Ladder (Rotates with Roll, Translates with Pitch) */}
        <div
          data-testid="hud-pitch-ladder"
          className="relative w-64 h-64 flex items-center justify-center transition-transform duration-75 ease-out"
          style={{
            transform: `rotate(${-currentRoll}deg) translateY(${currentPitch * 3}px)`,
          }}
        >
          {/* 00° Horizon Line */}
          <div className="absolute w-44 flex items-center justify-between text-[10px] font-bold text-emerald-300">
            <span className="flex items-center gap-1">
              <span>00</span>
              <span className="w-14 h-[2px] bg-emerald-400 shadow-[0_0_6px_#10b981]" />
            </span>
            <span className="flex items-center gap-1">
              <span className="w-14 h-[2px] bg-emerald-400 shadow-[0_0_6px_#10b981]" />
              <span>00</span>
            </span>
          </div>

          {/* +10° Pitch Up Line */}
          <div className="absolute top-12 w-36 flex items-center justify-between text-[9px] font-bold text-emerald-400/80">
            <span className="flex items-center gap-1">
              <span>+10</span>
              <span className="w-10 h-[1.5px] bg-emerald-400/80" />
            </span>
            <span className="flex items-center gap-1">
              <span className="w-10 h-[1.5px] bg-emerald-400/80" />
              <span>+10</span>
            </span>
          </div>

          {/* -10° Pitch Down Dashed Line */}
          <div className="absolute bottom-12 w-36 flex items-center justify-between text-[9px] font-bold text-emerald-400/80">
            <span className="flex items-center gap-1">
              <span>-10</span>
              <span className="w-10 h-[1.5px] border-b border-dashed border-emerald-400/80" />
            </span>
            <span className="flex items-center gap-1">
              <span className="w-10 h-[1.5px] border-b border-dashed border-emerald-400/80" />
              <span>-10</span>
            </span>
          </div>
        </div>

        {/* Flight-Path Marker (FPM) Velocity Vector */}
        <div
          data-testid="hud-flight-path-marker"
          className="absolute flex items-center justify-center drop-shadow-[0_0_8px_rgba(52,211,153,0.9)]"
        >
          {/* F-22 Aerospace Flight-Path Marker Symbol */}
          <svg
            viewBox="0 0 40 40"
            className="w-10 h-10 text-emerald-300"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            {/* Center Circle */}
            <circle cx="20" cy="20" r="5" />
            {/* Left Wing */}
            <line x1="3" y1="20" x2="15" y2="20" />
            {/* Right Wing */}
            <line x1="25" y1="20" x2="37" y2="20" />
            {/* Top Fin */}
            <line x1="20" y1="7" x2="20" y2="15" />
          </svg>
        </div>

        {/* Boresight Crosshair Center Waterline */}
        <div className="absolute w-2 h-2 rounded-full border border-emerald-400/40" />
      </div>

      {/* Bottom Telemetry Bar */}
      <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between text-[10px] text-emerald-500/80">
        <div>AR VIEW // REAL-TIME HUD</div>
        <div className="flex items-center gap-3">
          <span>PITCH: {currentPitch.toFixed(1)}°</span>
          <span>ROLL: {currentRoll.toFixed(1)}°</span>
          <span className="text-emerald-400 font-bold">LOCK: STEREO-OPTIC</span>
        </div>
      </div>
    </div>
  );
}
