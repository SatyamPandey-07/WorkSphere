"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";

export const MIN_DB_LIMIT = 30;
export const MAX_DB_LIMIT = 85;
export const DB_STEP = 5;
export const DEBOUNCE_MS = 300;

export interface NoiseZoneInfo {
  label: string;
  badgeClass: string;
  trackColorClass: string;
  dotColorClass: string;
}

export function getNoiseZoneInfo(db: number): NoiseZoneInfo {
  if (db <= 45) {
    return {
      label: "Library Quiet / Deep Work",
      badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
      trackColorClass: "bg-emerald-500",
      dotColorClass: "bg-emerald-400",
    };
  }
  if (db <= 60) {
    return {
      label: "Gentle Buzz / Casual Collab",
      badgeClass: "border-yellow-500/40 bg-yellow-500/15 text-yellow-300",
      trackColorClass: "bg-yellow-400",
      dotColorClass: "bg-yellow-400",
    };
  }
  if (db <= 75) {
    return {
      label: "Energetic Cafe",
      badgeClass: "border-orange-500/40 bg-orange-500/15 text-orange-300",
      trackColorClass: "bg-orange-500",
      dotColorClass: "bg-orange-400",
    };
  }
  return {
    label: "Loud / Social Hub",
    badgeClass: "border-red-500/40 bg-red-500/15 text-red-300",
    trackColorClass: "bg-red-500",
    dotColorClass: "bg-red-400",
  };
}

function clampDb(value: number): number {
  return Math.max(MIN_DB_LIMIT, Math.min(MAX_DB_LIMIT, value));
}

interface NoiseLevelSliderProps {
  minDb?: number;
  maxDb?: number;
  onChange: (range: { minDb: number; maxDb: number }) => void;
  debounceMs?: number;
}

export const NoiseLevelSlider: React.FC<NoiseLevelSliderProps> = ({
  minDb = MIN_DB_LIMIT,
  maxDb = MAX_DB_LIMIT,
  onChange,
  debounceMs = DEBOUNCE_MS,
}) => {
  const [localMin, setLocalMin] = useState<number>(() =>
    clampDb(Math.min(minDb, maxDb)),
  );
  const [localMax, setLocalMax] = useState<number>(() =>
    clampDb(Math.max(minDb, maxDb)),
  );
  const [activeThumb, setActiveThumb] = useState<"min" | "max" | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRenderRef = useRef(true);

  // Sync external URL / reset changes into local slider state
  useEffect(() => {
    setLocalMin(clampDb(Math.min(minDb, maxDb)));
    setLocalMax(clampDb(Math.max(minDb, maxDb)));
  }, [minDb, maxDb]);

  // Debounce query/filter callback updates by 300ms
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onChange({ minDb: localMin, maxDb: localMax });
      debounceTimerRef.current = null;
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [localMin, localMax, debounceMs, onChange]);

  const handleMinChange = useCallback(
    (nextRaw: number) => {
      const clamped = clampDb(nextRaw);
      setLocalMin(Math.min(clamped, localMax));
    },
    [localMax],
  );

  const handleMaxChange = useCallback(
    (nextRaw: number) => {
      const clamped = clampDb(nextRaw);
      setLocalMax(Math.max(clamped, localMin));
    },
    [localMin],
  );

  const handleKeyDown = (
    thumb: "min" | "max",
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    const current = thumb === "min" ? localMin : localMax;
    const apply = thumb === "min" ? handleMinChange : handleMaxChange;

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      apply(current + DB_STEP);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      apply(current - DB_STEP);
    } else if (event.key === "Home") {
      event.preventDefault();
      apply(MIN_DB_LIMIT);
    } else if (event.key === "End") {
      event.preventDefault();
      apply(MAX_DB_LIMIT);
    }
  };

  const totalSpan = MAX_DB_LIMIT - MIN_DB_LIMIT;
  const leftPercent = ((localMin - MIN_DB_LIMIT) / totalSpan) * 100;
  const rightPercent = ((localMax - MIN_DB_LIMIT) / totalSpan) * 100;

  // Use upper bound (or midpoint) to show live acoustic ceiling color shift
  const activeZone = getNoiseZoneInfo(localMax);
  const minZone = getNoiseZoneInfo(localMin);

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-slate-100">
            Ambient Noise Level
          </span>
        </div>
        <span className="font-mono text-xs font-semibold text-slate-200">
          {localMin}–{localMax} dB
        </span>
      </div>

      {/* Live Color-Shifting Acoustic Zone Indicator */}
      <div
        aria-live="polite"
        className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors duration-300 ${activeZone.badgeClass}`}
      >
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full transition-colors duration-300 ${activeZone.dotColorClass}`}
          />
          <span>{activeZone.label}</span>
        </span>
        {minZone.label !== activeZone.label && (
          <span className="text-[11px] opacity-80">from {minZone.label}</span>
        )}
      </div>

      {/* Dual-Handle Range Track */}
      <div className="relative flex h-7 items-center select-none">
        {/* Base Track */}
        <div className="h-2 w-full rounded-full bg-slate-800" />

        {/* Selected Active Range Track */}
        <div
          style={{
            left: `${leftPercent}%`,
            width: `${Math.max(0, rightPercent - leftPercent)}%`,
          }}
          className={`pointer-events-none absolute h-2 rounded-full transition-colors duration-300 ${activeZone.trackColorClass}`}
        />

        {/* Minimum dB Range Input */}
        <input
          type="range"
          min={MIN_DB_LIMIT}
          max={MAX_DB_LIMIT}
          step={DB_STEP}
          value={localMin}
          aria-label="Minimum decibel level (dB)"
          aria-valuemin={MIN_DB_LIMIT}
          aria-valuemax={localMax}
          aria-valuenow={localMin}
          aria-valuetext={`${localMin} dB (${minZone.label})`}
          onFocus={() => setActiveThumb("min")}
          onBlur={() => setActiveThumb(null)}
          onChange={(e) => handleMinChange(Number(e.target.value))}
          onKeyDown={(e) => handleKeyDown("min", e)}
          style={{
            zIndex: activeThumb === "min" || localMin >= localMax - 5 ? 30 : 20,
          }}
          className="pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-950 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-950 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
        />

        {/* Maximum dB Range Input */}
        <input
          type="range"
          min={MIN_DB_LIMIT}
          max={MAX_DB_LIMIT}
          step={DB_STEP}
          value={localMax}
          aria-label="Maximum decibel level (dB)"
          aria-valuemin={localMin}
          aria-valuemax={MAX_DB_LIMIT}
          aria-valuenow={localMax}
          aria-valuetext={`${localMax} dB (${activeZone.label})`}
          onFocus={() => setActiveThumb("max")}
          onBlur={() => setActiveThumb(null)}
          onChange={(e) => handleMaxChange(Number(e.target.value))}
          onKeyDown={(e) => handleKeyDown("max", e)}
          style={{ zIndex: activeThumb === "max" ? 30 : 25 }}
          className="pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-950 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-950 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
        />
      </div>

      {/* Scale Ticks */}
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>30 dB</span>
        <span>45 dB</span>
        <span>60 dB</span>
        <span>75 dB</span>
        <span>85 dB</span>
      </div>
    </div>
  );
};

export default NoiseLevelSlider;
