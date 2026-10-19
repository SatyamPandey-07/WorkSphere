"use client";

import React, { memo, useMemo, useState, useEffect } from "react";

export type TravelMode = "walking" | "cycling" | "transit" | "flight";

export interface Waypoint {
  id: string;
  name: string;
  coordinates: [number, number]; // [x, y] in percentage (0-100) or SVG viewport units (0-800, 0-600)
  type?: "origin" | "destination" | "waypoint";
  eta?: string;
  altitude?: string;
}

export interface TacticalAirspaceMapProps {
  /** Array of route coordinates [[x1, y1], [x2, y2], ...] on the map grid */
  pathCoordinates?: [number, number][];
  /** Active travel mode for commute */
  mode?: TravelMode;
  /** Waypoints to mark on the tactical airspace grid */
  waypoints?: Waypoint[];
  /** Glow intensity for emerald hard-light construct */
  glowIntensity?: "subtle" | "normal" | "intense";
  /** Optional flight altitude telemetry or flight callsign */
  flightCallsign?: string;
  /** Optional custom CSS class */
  className?: string;
  /** Callback when waypoint is clicked */
  onSelectWaypoint?: (waypoint: Waypoint) => void;
}

export const TacticalAirspaceMap: React.FC<TacticalAirspaceMapProps> = memo(({
  pathCoordinates = [
    [100, 480],
    [240, 420],
    [380, 460],
    [520, 310],
    [640, 240],
    [720, 160],
  ],
  mode = "walking",
  waypoints = [
    { id: "wp-origin", name: "Alpha Hub (Nomad Base)", coordinates: [100, 480] as [number, number], type: "origin" as const, eta: "00:00" },
    { id: "wp-dest", name: "Green Lantern Cowork Lab", coordinates: [720, 160] as [number, number], type: "destination" as const, eta: "+18m", altitude: "FL045" },
  ],
  glowIntensity = "normal",
  flightCallsign = "SECTOR-2814 // AIRSPACE-01",
  className = "",
  onSelectWaypoint,
}) => {
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener?.("change", handler);
      return () => mediaQuery.removeEventListener?.("change", handler);
    }
  }, []);

  // Compute SVG polyline string from points
  const pointsString = useMemo(() => {
    return pathCoordinates.map(([x, y]) => `${x},${y}`).join(" ");
  }, [pathCoordinates]);

  // Glow filter configurations
  const glowConfig = useMemo(() => {
    switch (glowIntensity) {
      case "subtle":
        return {
          blur: 3,
          opacity: 0.45,
          color: "#10b981",
          filterId: "hard-light-glow-subtle",
        };
      case "intense":
        return {
          blur: 10,
          opacity: 0.95,
          color: "#00ff88",
          filterId: "hard-light-glow-intense",
        };
      case "normal":
      default:
        return {
          blur: 6,
          opacity: 0.75,
          color: "#10b981",
          filterId: "hard-light-glow-normal",
        };
    }
  }, [glowIntensity]);

  const travelSpeedKts = useMemo(() => {
    switch (mode) {
      case "walking":
        return "15 KTS (PEDESTRIAN TACTICAL)";
      case "cycling":
        return "45 KTS (CYCLE CONSTRUCT)";
      case "transit":
        return "120 KTS (TRANSIT VECTOR)";
      case "flight":
        return "350 KTS (SUPERSONIC COCKPIT)";
      default:
        return "30 KTS";
    }
  }, [mode]);

  return (
    <div
      className={`relative w-full rounded-2xl bg-[#03150c]/95 border border-emerald-500/30 shadow-[0_0_25px_rgba(16,185,129,0.15)] overflow-hidden font-mono text-emerald-400 select-none ${className}`}
      data-testid="tactical-airspace-map"
      role="region"
      aria-label="Tactical Airspace Navigation Map"
    >
      <style>{`
        @keyframes laser-pulse-flow {
          0% {
            stroke-dashoffset: 64;
          }
          100% {
            stroke-dashoffset: 0;
          }
        }
        @keyframes radar-sweep {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        @keyframes waypoint-ping {
          0% {
            r: 4;
            opacity: 0.9;
          }
          100% {
            r: 16;
            opacity: 0;
          }
        }
        .construct-laser-pulse {
          animation: ${prefersReducedMotion ? "none" : "laser-pulse-flow 1.8s linear infinite"};
        }
        .construct-radar-rotator {
          animation: ${prefersReducedMotion ? "none" : "radar-sweep 8s linear infinite"};
          transform-origin: 400px 300px;
        }
        .waypoint-ping-anim {
          animation: ${prefersReducedMotion ? "none" : "waypoint-ping 2.2s cubic-bezier(0, 0, 0.2, 1) infinite"};
        }
      `}</style>

      {/* Cockpit HUD Top Telemetry Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-950/40 border-b border-emerald-500/20 text-xs backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="font-bold tracking-wider text-emerald-300">
            {flightCallsign}
          </span>
        </div>
        <div className="flex items-center space-x-4 text-[11px] text-emerald-400/80">
          <span>VELOCITY: <strong className="text-emerald-200">{travelSpeedKts}</strong></span>
          <span className="hidden sm:inline">CONSTRUCT: <strong className="text-emerald-300">SOLID GREEN // HARD-LIGHT</strong></span>
          <span className="uppercase text-emerald-500 border border-emerald-500/30 px-1.5 py-0.5 rounded text-[10px]">
            GLOW: {glowIntensity}
          </span>
        </div>
      </div>

      {/* SVG Canvas Airspace Map Viewport */}
      <div className="relative w-full aspect-[4/3] max-h-[600px] overflow-hidden">
        <svg
          viewBox="0 0 800 600"
          className="w-full h-full transform-gpu"
          aria-hidden="true"
        >
          <defs>
            {/* Emerald Hard-Light Glow Filter */}
            <filter id={glowConfig.filterId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation={glowConfig.blur} result="blur1" />
              <feMerge>
                <feMergeNode in="blur1" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Tactical Grid Pattern */}
            <pattern id="tactical-grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="rgba(16, 185, 129, 0.08)"
                strokeWidth="1"
              />
            </pattern>

            {/* Linear Gradient along Flight Vector */}
            <linearGradient id="emeraldConstructGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#059669" stopOpacity="0.4" />
              <stop offset="50%" stopColor="#10b981" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="1" />
            </linearGradient>
          </defs>

          {/* Grid Background */}
          <rect width="800" height="600" fill="#02120a" />
          <rect width="800" height="600" fill="url(#tactical-grid-pattern)" />

          {/* Radar Horizon Rings */}
          <circle cx="400" cy="300" r="100" fill="none" stroke="rgba(16, 185, 129, 0.12)" strokeDasharray="3 6" />
          <circle cx="400" cy="300" r="200" fill="none" stroke="rgba(16, 185, 129, 0.10)" strokeDasharray="4 8" />
          <circle cx="400" cy="300" r="280" fill="none" stroke="rgba(16, 185, 129, 0.08)" strokeDasharray="6 12" />

          {/* Radar Rotating Sweep Line */}
          <line
            x1="400"
            y1="300"
            x2="400"
            y2="20"
            stroke="rgba(52, 211, 153, 0.2)"
            strokeWidth="1.5"
            className="construct-radar-rotator"
          />

          {/* Base Polyline Track (Dim Hard-Light Core) */}
          <polyline
            points={pointsString}
            fill="none"
            stroke="rgba(5, 150, 105, 0.45)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Primary Hard-Light Construct Glow Track */}
          <polyline
            points={pointsString}
            fill="none"
            stroke={glowConfig.color}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${glowConfig.filterId})`}
            strokeOpacity={glowConfig.opacity}
          />

          {/* Traveling Emerald Hard-Light Laser Pulses */}
          <polyline
            points={pointsString}
            fill="none"
            stroke="#a7f3d0"
            strokeWidth="2.5"
            strokeDasharray="16 32"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="construct-laser-pulse"
          />

          {/* Waypoints & Pins */}
          {waypoints.map((wp) => {
            const [wx, wy] = wp.coordinates;
            const isOrigin = wp.type === "origin";
            const isDest = wp.type === "destination";
            const isSelected = selectedWaypointId === wp.id;

            return (
              <g
                key={wp.id}
                className="cursor-pointer group"
                onClick={() => {
                  setSelectedWaypointId(wp.id);
                  onSelectWaypoint?.(wp);
                }}
                tabIndex={0}
                role="button"
                aria-label={`Waypoint ${wp.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setSelectedWaypointId(wp.id);
                    onSelectWaypoint?.(wp);
                  }
                }}
              >
                {/* Pulsing Sonar Ring */}
                <circle
                  cx={wx}
                  cy={wy}
                  r="6"
                  fill="none"
                  stroke={isDest ? "#34d399" : "#10b981"}
                  strokeWidth="1.5"
                  className="waypoint-ping-anim"
                />

                {/* Outer Ring */}
                <circle
                  cx={wx}
                  cy={wy}
                  r={isSelected ? 10 : 7}
                  fill={isDest ? "rgba(16, 185, 129, 0.4)" : "rgba(6, 78, 59, 0.6)"}
                  stroke={isDest ? "#00ff88" : "#34d399"}
                  strokeWidth="2"
                  filter={`url(#${glowConfig.filterId})`}
                />

                {/* Core Pin Dot */}
                <circle
                  cx={wx}
                  cy={wy}
                  r="3.5"
                  fill={isDest ? "#ffffff" : "#a7f3d0"}
                />

                {/* Waypoint Label HUD Box */}
                <g transform={`translate(${wx + 12}, ${wy - 18})`}>
                  <rect
                    x="0"
                    y="0"
                    width={wp.name.length * 7.5 + 40}
                    height="24"
                    rx="4"
                    fill="rgba(3, 21, 12, 0.85)"
                    stroke={isSelected ? "#00ff88" : "rgba(16, 185, 129, 0.4)"}
                    strokeWidth="1"
                  />
                  <text
                    x="8"
                    y="16"
                    fill={isSelected ? "#00ff88" : "#34d399"}
                    fontSize="11"
                    fontFamily="monospace"
                    fontWeight={isSelected ? "bold" : "normal"}
                  >
                    {isOrigin ? "[ORIGIN] " : isDest ? "[TARGET] " : "[WP] "}
                    {wp.name} {wp.eta ? `(${wp.eta})` : ""}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* Screen Reader Accessible Live Region */}
        <div className="sr-only" aria-live="polite">
          Active tactical airspace flight route: {pathCoordinates.length} waypoints plotted.
          Mode: {mode}. Glow intensity: {glowIntensity}.
          Origin: {waypoints[0]?.name || "Base"}, Destination: {waypoints[waypoints.length - 1]?.name || "Venue"}.
        </div>
      </div>

      {/* Cockpit HUD Bottom Status Strip */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-emerald-950/60 border-t border-emerald-500/20 text-[11px] text-emerald-400/80">
        <div className="flex items-center space-x-4">
          <span>COORDINATES: <span className="text-emerald-300">WGS84 HARD-LIGHT PROJECTION</span></span>
          <span className="hidden md:inline">WAYPOINTS: <span className="text-emerald-300">{waypoints.length} VERIFIED</span></span>
        </div>
        <div className="text-emerald-500">
          HARD-LIGHT CONSTRUCT SHADER: READY // 60 FPS SUSTAINED
        </div>
      </div>
    </div>
  );
});

TacticalAirspaceMap.displayName = "TacticalAirspaceMap";

export default TacticalAirspaceMap;
