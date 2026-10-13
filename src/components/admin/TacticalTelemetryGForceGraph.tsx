'use client';

import React from 'react';

/**
 * TacticalTelemetryGForceGraph — V-n (flight envelope) diagram for the
 * administrative dashboard.
 *
 * Client FPS, scroll inertia and input latency are mapped onto simulated
 * G-force loads so an operator can read UI smoothness the same way a pilot
 * reads structural load limits:
 *
 *  - 1G  : nominal 60fps idle operation (level flight)
 *  - ~3G : high scroll velocity / heavy inertia
 *  - 9G  : severe frame-drop stall (structural limit, redline)
 *  - Negative load: input latency dominates (inverted, unresponsive feel)
 *
 * The pure mapping lives in `calculateGForceLoad` so it can be unit tested
 * independently of the SVG rendering.
 */

export interface GForceInput {
  /** Observed client frame rate, e.g. 60 for a healthy rAF loop. */
  fps: number;
  /** Absolute scroll velocity in px/ms. */
  scrollVelocity: number;
  /** Measured input-to-paint latency in milliseconds. */
  latencyMs: number;
}

/** Structural envelope limits used for rendering the V-n diagram. */
export const G_LOAD_LIMITS = {
  /** Severe stall redline — frame drops below ~10fps. */
  maxPositive: 9,
  /** Deepest negative load — total inverted responsiveness. */
  maxNegative: -3,
  /** Baseline load for nominal 60fps idle operation. */
  nominal: 1,
} as const;

/** Hard bounds applied to the computed load. */
const G_LOAD_CLAMP: [number, number] = [G_LOAD_LIMITS.maxNegative, G_LOAD_LIMITS.maxPositive];

/** Scroll contribution saturates at this velocity (px/ms ≈ 3000 px/s). */
const SCROLL_SATURATION_PX_MS = 3;

/** Scroll load added at (and above) the saturation velocity, in G. */
const SCROLL_MAX_LOAD = 2;

/** Latency band where the UI still feels instantaneous. */
const LATENCY_CLEAN_MS = 50;
/** Latency beyond which the negative-G (inverted) stall dominates. */
const LATENCY_STALL_MS = 200;

/** Fraction of the "stall to redline" band charged per G of deficit. */
const FPS_DEFICIT_TO_LOAD = 6 / 45; // 6G spread over the 60 → 15fps deficit band

/**
 * Pure helper: map responsiveness telemetry to a simulated G-force load.
 *
 * Positive G (1 → 9): scroll inertia and frame-drop stalls loading the
 * "airframe" — the faster the scroll and the lower the FPS, the higher the
 * load. Negative G (0 → -3): input latency unloading the envelope, i.e. the
 * inverted, rubber-banding feel of an unresponsive UI.
 *
 * The result is clamped to [-3, +9].
 */
export function calculateGForceLoad(fps: number, scrollVelocity: number, latencyMs: number): number {
  // --- Scroll inertia: 1G baseline + up to +2G of dynamic load. ----------
  const speed = Math.max(0, scrollVelocity);
  const scrollLoad = SCROLL_MAX_LOAD * Math.min(speed / SCROLL_SATURATION_PX_MS, 1);

  // --- Frame-drop stall: deficits below 60fps charge toward +9G. ---------
  const fpsClamped = Math.min(Math.max(fps, 0), 120);
  const fpsDeficit = Math.max(0, 60 - fpsClamped); // 0 → 60
  // Below ~15fps the loop is considered fully stalled and pegs the redline.
  const stallLoad =
    fpsDeficit >= 45
      ? 6 + (fpsDeficit - 45) * 0.24 // 45 → 60 deficit maps 6G → 9.6G (clamped)
      : fpsDeficit * FPS_DEFICIT_TO_LOAD;

  // --- Input latency: clean <50ms; inverted negative load beyond 200ms. --
  let latencyLoad = 0;
  if (latencyMs > LATENCY_STALL_MS) {
    // 200ms → 0G, 700ms → -3G (deepest negative load).
    latencyLoad = -Math.min((latencyMs - LATENCY_STALL_MS) / (500 / 3), 3);
  } else if (latencyMs > LATENCY_CLEAN_MS) {
    // Mild 50–200ms lag neutralises the 1G baseline gradually toward 0G.
    latencyLoad = -((latencyMs - LATENCY_CLEAN_MS) / (LATENCY_STALL_MS - LATENCY_CLEAN_MS)) * 1;
  }

  const load = G_LOAD_LIMITS.nominal + scrollLoad + stallLoad + latencyLoad;
  return Math.min(Math.max(load, G_LOAD_CLAMP[0]), G_LOAD_CLAMP[1]);
}

/** Classification bucket used for colouring the readout. */
export function classifyLoad(load: number): 'nominal' | 'elevated' | 'critical' | 'stalled' {
  if (load < 0) return 'stalled';
  if (load < 2) return 'nominal';
  if (load < 6) return 'elevated';
  return 'critical';
}

const CLASS_STYLES: Record<ReturnType<typeof classifyLoad>, string> = {
  nominal: '#22d3ee',
  elevated: '#fbbf24',
  critical: '#ef4444',
  stalled: '#a855f7',
};

const VIEW_W = 320;
const VIEW_H = 200;
const PAD_X = 34;
const PAD_Y = 20;

/** Map a G value (-3 … 9) to a y coordinate inside the padded viewBox. */
function gToY(g: number): number {
  const span = G_LOAD_LIMITS.maxPositive - G_LOAD_LIMITS.maxNegative;
  const t = (g - G_LOAD_LIMITS.maxNegative) / span;
  return PAD_Y + (VIEW_H - PAD_Y * 2) * (1 - t);
}

export interface TacticalTelemetryGForceGraphProps {
  fps: number;
  scrollVelocity: number;
  latencyMs: number;
  /** Accessible label for the graph region. */
  title?: string;
  className?: string;
}

export function TacticalTelemetryGForceGraph({
  fps,
  scrollVelocity,
  latencyMs,
  title = 'Responsiveness flight envelope (V-n diagram)',
  className,
}: TacticalTelemetryGForceGraphProps) {
  const load = calculateGForceLoad(fps, scrollVelocity, latencyMs);
  const bucket = classifyLoad(load);
  const color = CLASS_STYLES[bucket];

  const plotY = gToY(load);
  const plotX = PAD_X + (VIEW_W - PAD_X * 2) * 0.5;

  // Envelope boundary curve: the classic V shape (simplified for telemetry).
  const cornerY = gToY(6);
  const envelope = `M ${PAD_X} ${gToY(1)} L ${PAD_X + 20} ${cornerY} L ${VIEW_W - PAD_X - 20} ${cornerY} L ${VIEW_W - PAD_X} ${gToY(1)}`;

  return (
    <div
      className={`bg-gray-800 border border-gray-700 rounded-xl p-4 ${className ?? ''}`}
    >
      <h3 className="text-sm font-medium text-gray-400 mb-2">{title}</h3>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`${title}: current load ${load.toFixed(1)}G, ${fps} FPS`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Stall / overspeed zones */}
        <rect x={PAD_X} y={gToY(9)} width={VIEW_W - PAD_X * 2} height={gToY(6) - gToY(9)} fill="#ef4444" opacity="0.15" />
        <rect x={PAD_X} y={gToY(-3)} width={VIEW_W - PAD_X * 2} height={gToY(-1) - gToY(-3)} fill="#a855f7" opacity="0.15" />

        {/* Envelope curves */}
        <path d={envelope} fill="none" stroke="#64748b" strokeWidth="1.5" />
        <line x1={PAD_X} y1={gToY(-1)} x2={VIEW_W - PAD_X} y2={gToY(-1)} stroke="#64748b" strokeWidth="1.5" />

        {/* Redlines */}
        <line x1={PAD_X} y1={gToY(9)} x2={VIEW_W - PAD_X} y2={gToY(9)} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3" />
        <line x1={PAD_X} y1={gToY(-3)} x2={VIEW_W - PAD_X} y2={gToY(-3)} stroke="#a855f7" strokeWidth="1.5" strokeDasharray="4 3" />
        <line x1={PAD_X} y1={gToY(1)} x2={VIEW_W - PAD_X} y2={gToY(1)} stroke="#22d3ee" strokeWidth="0.75" strokeDasharray="2 3" />

        {/* Axis labels */}
        {[9, 6, 1, -1, -3].map((g) => (
          <text key={g} x={PAD_X - 6} y={gToY(g) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
            {g}G
          </text>
        ))}

        {/* Current load marker */}
        <line x1={PAD_X} y1={plotY} x2={VIEW_W - PAD_X} y2={plotY} stroke={color} strokeWidth="1.5" opacity="0.6" />
        <circle cx={plotX} cy={plotY} r="5" fill={color} stroke="#0f172a" strokeWidth="1.5" />

        {/* Readout */}
        <text x={VIEW_W - PAD_X} y={PAD_Y + 10} textAnchor="end" fontSize="12" fontWeight="bold" fill={color}>
          {load.toFixed(1)}G
        </text>
        <text x={VIEW_W / 2} y={VIEW_H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">
          {fps} FPS · {scrollVelocity.toFixed(1)} px/ms · {Math.round(latencyMs)} ms latency
        </text>
      </svg>
    </div>
  );
}

export default TacticalTelemetryGForceGraph;
