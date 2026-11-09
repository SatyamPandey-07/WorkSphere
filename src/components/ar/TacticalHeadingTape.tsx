"use client";

import React, { useState, useEffect } from "react";
import { Navigation, Compass } from "lucide-react";

export interface TacticalHeadingTapeProps {
  externalHeading?: number; // Optional external bearing or camera angle override
  targetBearing?: number;   // Target venue bearing bug indicator (0-360)
  onHeadingUpdate?: (heading: number) => void;
}

export const TacticalHeadingTape: React.FC<TacticalHeadingTapeProps> = ({
  externalHeading,
  targetBearing = 135, // Default target venue bug
  onHeadingUpdate,
}) => {
  const sanitizeHeading = (val?: number): number => {
    if (typeof val === "number" && Number.isFinite(val)) {
      return ((val % 360) + 360) % 360;
    }
    return 0;
  };

  const [heading, setHeading] = useState<number>(() => sanitizeHeading(externalHeading));
  const [isCalibrated, setIsCalibrated] = useState<boolean>(false);

  const safeTargetBearing =
    typeof targetBearing === "number" && Number.isFinite(targetBearing)
      ? ((targetBearing % 360) + 360) % 360
      : 135;

  // Smooth low-pass filter / LERP for compass rotation
  useEffect(() => {
    if (externalHeading !== undefined && Number.isFinite(externalHeading)) {
      const target = ((externalHeading % 360) + 360) % 360;
      setHeading((prev) => {
        const safePrev = Number.isFinite(prev) ? prev : 0;
        const diff = (target - safePrev + 540) % 360 - 180;
        return (safePrev + diff * 0.2 + 360) % 360;
      });
    }
  }, [externalHeading]);

  // Device orientation magnetometer listener for mobile/AR mode
  useEffect(() => {
    if (externalHeading !== undefined) return;

    let currentHeading = 0;
    const handleOrientation = (
      event: DeviceOrientationEvent & { alpha?: number; webkitCompassHeading?: number },
    ) => {
      let rawHeading: number | null = null;
      if (typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)) {
        rawHeading = event.webkitCompassHeading;
      } else if (typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
        rawHeading = (360 - event.alpha) % 360;
      }

      if (rawHeading !== null) {
        currentHeading += (rawHeading - currentHeading) * 0.15;
        const normalized = ((currentHeading % 360) + 360) % 360;
        setHeading(normalized);
        setIsCalibrated(true);
        if (onHeadingUpdate) onHeadingUpdate(normalized);
      }
    };

    if (
      typeof window !== "undefined" &&
      "DeviceOrientationEvent" in window &&
      window.DeviceOrientationEvent
    ) {
      window.addEventListener("deviceorientation", handleOrientation as EventListener, true);
    } else {
      const interval = setInterval(() => {
        setHeading((prev) => (prev + 0.5) % 360);
        setIsCalibrated(true);
      }, 100);
      (interval as any)?.unref?.();
      return () => clearInterval(interval);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("deviceorientation", handleOrientation as EventListener, true);
      }
    };
  }, [externalHeading, onHeadingUpdate]);

  // Generate ticks for 0 to 360 degrees
  const ticks: { deg: number; label: string; isMajor: boolean }[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    let label = "";
    if (deg === 0) label = "N";
    else if (deg === 30) label = "030";
    else if (deg === 60) label = "060";
    else if (deg === 90) label = "E";
    else if (deg === 120) label = "120";
    else if (deg === 150) label = "150";
    else if (deg === 180) label = "S";
    else if (deg === 210) label = "210";
    else if (deg === 240) label = "240";
    else if (deg === 270) label = "W";
    else if (deg === 300) label = "300";
    else if (deg === 330) label = "330";

    const isMajor = deg % 30 === 0;
    ticks.push({ deg, label, isMajor });
  }

  const safeHeading = Number.isFinite(heading) ? heading : 0;
  const tapeOffset = safeHeading * 4;

  return (
    <div
      data-testid="tactical-heading-tape"
      className="absolute top-0 inset-x-0 z-40 flex flex-col items-center pointer-events-none select-none font-mono"
    >
      {/* HUD Header Data Display */}
      <div className="bg-slate-950/80 border-b border-emerald-500/30 backdrop-blur-md px-4 py-1.5 rounded-b-xl shadow-[0_4px_20px_rgba(16,185,129,0.15)] flex items-center gap-4 text-emerald-400 text-xs">
        <div className="flex items-center gap-1.5">
          <Compass className="w-4 h-4 animate-spin" style={{ animationDuration: "12s" }} />
          <span className="font-bold tracking-widest">HDG: {Math.round(safeHeading)}°</span>
        </div>
        <span className="text-slate-600">|</span>
        <div className="flex items-center gap-1.5 text-slate-300">
          <Navigation className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            VENUE TARGET: <strong className="text-emerald-300">{Math.round(safeTargetBearing)}°</strong>
          </span>
        </div>
        <span className="text-slate-600">|</span>
        <span className="text-[10px] text-emerald-500 uppercase tracking-wider">
          {isCalibrated ? "MAG CALIBRATED" : "ACQUIRING FIX..."}
        </span>
      </div>

      {/* Horizontal Scrolling Compass Ribbon */}
      <div className="relative w-full max-w-xl h-14 bg-slate-950/70 border-x border-b border-emerald-500/20 backdrop-blur-sm overflow-hidden mt-1 rounded-b-2xl shadow-lg">
        {/* Center Indicator Chevron / Reticle */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
          <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          <div className="w-0.5 h-10 bg-gradient-to-b from-emerald-400/80 to-transparent" />
        </div>

        {/* Target Venue Bearing Bug Indicator */}
        {targetBearing !== undefined && (() => {
          const diff = (safeTargetBearing - safeHeading + 540) % 360 - 180;
          return (
            <div
              data-testid="target-bearing-bug"
              className="absolute top-2 z-10 flex flex-col items-center transition-all duration-75"
              style={{ left: `calc(50% + ${diff * 4}px)` }}
            >
              <div className="bg-emerald-500 text-slate-950 text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-[0_0_10px_rgba(16,185,129,0.9)] uppercase">
                TARGET
              </div>
              <div className="w-1 h-3 bg-emerald-400 mt-0.5 animate-pulse" />
            </div>
          );
        })()}

        {/* Scrolling Ticks Strip */}
        <div
          className="absolute top-4 h-10 flex items-center will-change-transform"
          style={{
            transform: `translateX(calc(50% - ${tapeOffset}px))`,
            transition: externalHeading !== undefined ? "transform 0.1s linear" : "none",
          }}
        >
          {[-360, 0, 360].map((offset) => (
            <div key={offset} className="flex">
              {ticks.map((t) => (
                <div
                  key={`${offset}-${t.deg}`}
                  className="flex flex-col items-center justify-start"
                  style={{ width: "20px" }}
                >
                  <span
                    className={`font-mono font-bold ${
                      t.label ? "text-slate-200 text-xs" : "text-slate-600 text-[9px]"
                    }`}
                  >
                    {t.label || (t.isMajor ? "|" : "·")}
                  </span>
                  <div
                    className={`bg-emerald-500/60 mt-1 ${
                      t.label ? "w-0.5 h-3" : t.isMajor ? "w-0.5 h-2" : "w-[1px] h-1"
                    }`}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TacticalHeadingTape;
