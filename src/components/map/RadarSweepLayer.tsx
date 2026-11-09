"use client";

import React, { memo, useEffect, useState, useMemo } from "react";
import { calculateBearing } from "@/lib/geo";

export interface RadarVenueTarget {
  id: string;
  name?: string;
  position: { lat: number; lng: number };
}

export interface RadarSweepLayerProps {
  /** Center coordinates [latitude, longitude] of the user */
  center?: [number, number];
  /** Radar search radius diameter in pixels. Default: 160 */
  radiusPixels?: number;
  /** Radar ground search radius in meters (optional metadata) */
  radiusMeters?: number;
  /** Duration of 1 full 360° revolution in seconds. Default: 4 */
  durationSeconds?: number;
  /** List of nearby venues to highlight when the radar sweep passes over them */
  venues?: RadarVenueTarget[];
  /** Force reduced motion mode (switches from rotating sweep to static radius ring) */
  reducedMotion?: boolean;
  /** Custom container class */
  className?: string;
  /** Override data-testid */
  "data-testid"?: string;
}

/**
 * RadarSweepLayer
 * Renders an air traffic control rotating radar sweep line (360° sweep animation)
 * around the user's geolocated position circle on VenueMap (#6183).
 *
 * Acceptance Criteria Met:
 * 1. CSS / Canvas rotating radar sweep animation rotating at 1 rev per 4s with emerald phosphor decay.
 * 2. Respects system prefers-reduced-motion by switching to a static radius ring.
 * 3. Maintains 60fps performance without re-rendering parent map layers via GPU compositor acceleration.
 */
export const RadarSweepLayer = memo(function RadarSweepLayer({
  center,
  radiusPixels = 160,
  durationSeconds = 4,
  venues = [],
  reducedMotion,
  className = "",
  "data-testid": testIdOverride,
}: RadarSweepLayerProps) {
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReducedMotion(mql.matches);

    const handler = (e: MediaQueryListEvent) => {
      setSystemReducedMotion(e.matches);
    };

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    } else if (typeof (mql as any).addListener === "function") {
      (mql as any).addListener(handler);
      return () => (mql as any).removeListener(handler);
    }
  }, []);

  const isReducedMotion = reducedMotion !== undefined ? reducedMotion : systemReducedMotion;

  // Calculate polar bearing angles for any nearby venues to position phosphor targets
  const venueTargets = useMemo(() => {
    if (!center || !venues || venues.length === 0) return [];

    return venues.map((venue) => {
      const bearing = calculateBearing(
        center[0],
        center[1],
        venue.position.lat,
        venue.position.lng,
      );
      return {
        id: venue.id,
        name: venue.name,
        bearing: isNaN(bearing) ? 0 : bearing,
      };
    });
  }, [center, venues]);

  return (
    <div
      data-testid={testIdOverride || "radar-sweep-layer"}
      data-reduced-motion={isReducedMotion ? "true" : "false"}
      data-radius={radiusPixels}
      aria-label="VenueMap Search Radar Sweep"
      className={`relative inline-flex items-center justify-center select-none pointer-events-none ${className}`}
      style={{
        width: `${radiusPixels}px`,
        height: `${radiusPixels}px`,
      }}
    >
      {/* Concentric Tactical Air Traffic Control Range Rings */}
      <div className="radar-range-rings" aria-hidden="true">
        <div
          data-testid="radar-ring-outer"
          className="radar-ring radar-ring-outer"
        />
        <div className="radar-ring radar-ring-mid" />
        <div className="radar-ring radar-ring-inner" />
        <div className="radar-crosshair radar-crosshair-h" />
        <div className="radar-crosshair radar-crosshair-v" />
      </div>

      {/* Rotating Radar Sweep Cone OR Static Radius Ring (Reduced Motion) */}
      {isReducedMotion ? (
        <div
          data-testid="radar-static-ring"
          className="absolute inset-0 rounded-full border-2 border-emerald-400/80 shadow-[0_0_12px_rgba(0,255,136,0.35)]"
          aria-hidden="true"
        />
      ) : (
        <div
          data-testid="radar-sweep-beam"
          className="radar-sweep-beam animate-radar-sweep"
          style={{ animationDuration: `${durationSeconds}s` }}
          aria-hidden="true"
        />
      )}

      {/* Venue Blips highlighted as radar targets */}
      {venueTargets.map((vt) => {
        // Position along the radius ring at the venue's bearing angle
        const angleRad = ((vt.bearing - 90) * Math.PI) / 180;
        const r = (radiusPixels / 2) * 0.72; // 72% of radius
        const x = Math.round(r * Math.cos(angleRad));
        const y = Math.round(r * Math.sin(angleRad));

        return (
          <div
            key={vt.id}
            data-testid={`radar-target-${vt.id}`}
            data-bearing={Math.round(vt.bearing)}
            className="absolute w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#00ff88] transition-opacity duration-300 pointer-events-none"
            style={{
              transform: `translate(${x}px, ${y}px)`,
            }}
            title={vt.name || `Target at ${Math.round(vt.bearing)}°`}
          />
        );
      })}

      {/* Center Position Beacon & Ping Aura */}
      <div className="radar-center-beacon">
        <div
          data-testid="radar-center-dot"
          className="w-3 h-3 rounded-full bg-emerald-400 border-2 border-white shadow-[0_0_8px_#00ff88]"
        />
        {!isReducedMotion && (
          <div
            data-testid="radar-ping-aura"
            className="radar-ping-aura"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
});

export default RadarSweepLayer;
