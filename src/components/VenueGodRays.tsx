"use client";

import React, { useEffect, useRef, useMemo } from "react";
import { Sparkles, Sun, AlertCircle } from "lucide-react";
import { useGodRaysRenderer } from "@/hooks/useGodRaysRenderer";
import { calculateSunPosition } from "@/lib/sunPosition";

export interface VenueGodRaysProps {
  lat?: number | null;
  lng?: number | null;
  className?: string;
  height?: string | number;
  quality?: "low" | "medium" | "high";
}

export function VenueGodRays({
  lat,
  lng,
  className = "",
  height = "200px",
  quality = "medium",
}: VenueGodRaysProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const sunPos = useMemo(() => {
    if (typeof lat !== "number" || typeof lng !== "number") {
      return { sunX: 0.75, sunY: 0.85, isAboveHorizon: true };
    }
    const pos = calculateSunPosition(lat, lng);
    const sunX = Math.cos((pos.azimuth * Math.PI) / 180) * 0.4 + 0.5;
    const sunY = Math.sin((pos.altitude * Math.PI) / 180) * 0.4 + 0.6;
    return {
      sunX: Math.max(0.05, Math.min(0.95, sunX)),
      sunY: Math.max(0.05, Math.min(0.95, sunY)),
      isAboveHorizon: pos.isAboveHorizon,
    };
  }, [lat, lng]);

  const { isSupported, fps, canvas } = useGodRaysRenderer({
    sunX: sunPos.sunX,
    sunY: sunPos.sunY,
    intensity: sunPos.isAboveHorizon ? 0.7 : 0.2,
    rayLength: sunPos.isAboveHorizon ? 1.2 : 0.6,
    decay: 0.96,
    density: 4.0,
    weight: 0.04,
    quality,
    animate: true,
    resolutionScale: 0.75,
  });

  useEffect(() => {
    if (!canvas || !containerRef.current) return;
    containerRef.current.appendChild(canvas);
    return () => {
      if (canvas.parentElement) {
        canvas.parentElement.removeChild(canvas);
      }
    };
  }, [canvas]);

  return (
    <div
      className={`relative w-full rounded-3xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 ${className}`}
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      {!isSupported ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-amber-950 to-orange-950 text-white">
          <AlertCircle className="w-8 h-8 text-amber-400 mb-2" />
          <h4 className="text-sm font-bold">God Rays Unavailable</h4>
          <p className="text-xs text-zinc-400 max-w-xs mt-1">
            WebGL 2.0 is required for volumetric light shaft rendering.
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-full" />
      )}

      <div className="absolute inset-0 pointer-events-none p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-white text-[10px] font-semibold">
            <Sparkles className="w-3 h-3 text-amber-400 animate-pulse" />
            <span>WebGL 2.0 God Rays</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md text-[9px] font-mono text-zinc-300 border border-white/5">
              <Sun className="w-2.5 h-2.5 text-amber-300" />
              <span>
                {typeof lat === "number" && typeof lng === "number"
                  ? `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`
                  : "—"}
              </span>
            </div>
            <div className="px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md text-[10px] font-mono text-zinc-300 border border-white/5">
              {fps} FPS
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between">
          <div className="bg-black/65 backdrop-blur-xl border border-white/10 p-2.5 rounded-xl text-white text-[10px]">
            <p className="font-bold text-amber-200">Volumetric Light Shafts</p>
            <p className="text-zinc-400 mt-0.5">
              32-sample radial blur with procedural noise perturbation
            </p>
          </div>
          <div className="bg-black/40 backdrop-blur-md px-2 py-0.5 rounded-full text-[9px] text-zinc-400 border border-white/5">
            {sunPos.isAboveHorizon ? "Sunrise/Sunset" : "Night"} mode
          </div>
        </div>
      </div>
    </div>
  );
}
