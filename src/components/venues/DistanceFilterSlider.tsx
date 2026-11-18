"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Navigation, MapPin, Locate, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DistanceFilterSliderProps {
  value: number; // 0 for any distance, or 1-50 in km
  onChange: (distance: number) => void;
  defaultValue?: number; // default 10 km
  min?: number; // default 1 km
  max?: number; // default 50 km
  step?: number; // default 1 km
  presets?: number[]; // default [5, 10, 25, 50]
  userLocation?: { lat: number; lng: number } | null;
  onLocationDetected?: (loc: { lat: number; lng: number }) => void;
  className?: string;
  showLocationPrompt?: boolean;
  debounceMs?: number; // default 250ms debounce for external onChange
}

export function DistanceFilterSlider({
  value,
  onChange,
  defaultValue = 10,
  min = 1,
  max = 50,
  step = 1,
  presets = [5, 10, 25, 50],
  userLocation: propUserLocation = null,
  onLocationDetected,
  className,
  showLocationPrompt = true,
  debounceMs = 250,
}: DistanceFilterSliderProps) {
  const safeMin = typeof min === "number" && Number.isFinite(min) && min >= 0 ? min : 1;
  const safeMax = typeof max === "number" && Number.isFinite(max) && max > safeMin ? max : 50;
  const safeStep = typeof step === "number" && Number.isFinite(step) && step > 0 ? step : 1;
  const safeDefault = typeof defaultValue === "number" && Number.isFinite(defaultValue) ? defaultValue : 10;
  const safePresets = Array.isArray(presets)
    ? presets.filter((p) => typeof p === "number" && Number.isFinite(p) && p > 0)
    : [5, 10, 25, 50];

  const sanitizeVal = useCallback((val: number): number => {
    return typeof val === "number" && Number.isFinite(val) ? Math.max(0, val) : 0;
  }, []);

  const [localLocation, setLocalLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(propUserLocation);
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Internal visual slider state for 60fps instant UI response
  const [internalValue, setInternalValue] = useState<number>(() => sanitizeVal(value));
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestOnChangeRef = useRef(onChange);
  latestOnChangeRef.current = onChange;

  // Sync internal value when external value changes
  useEffect(() => {
    setInternalValue(sanitizeVal(value));
  }, [value, sanitizeVal]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Sync prop location
  useEffect(() => {
    if (propUserLocation) {
      setLocalLocation(propUserLocation);
    }
  }, [propUserLocation]);

  // Trigger immediate external change (for presets, reset, double-click)
  const commitImmediateChange = useCallback((newVal: number) => {
    const sanitized = sanitizeVal(newVal);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setInternalValue(sanitized);
    latestOnChangeRef.current(sanitized);
  }, [sanitizeVal]);

  // Handle slider drag with debounce
  const handleSliderChange = (newVal: number) => {
    const sanitized = sanitizeVal(newVal);
    setInternalValue(sanitized);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      latestOnChangeRef.current(sanitized);
    }, debounceMs);
  };

  // Commit immediately on pointer up / change end
  const handleSliderCommit = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    latestOnChangeRef.current(internalValue);
  };

  // Request browser geolocation
  const requestLocation = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setGeoError("Geolocation is not supported by your browser");
      return;
    }

    setIsLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setLocalLocation(coords);
        setIsLocating(false);
        if (onLocationDetected) {
          onLocationDetected(coords);
        }
      },
      (err) => {
        setIsLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError("Location permission denied. Distances may use city center.");
        } else {
          setGeoError("Unable to retrieve your current location.");
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }, [onLocationDetected]);

  const isAnyDistance = internalValue === 0 || internalValue < safeMin;
  const sliderDisplayValue = isAnyDistance ? safeMin : internalValue;

  // Reset to default radius on double-click
  const handleResetToDefault = useCallback(() => {
    commitImmediateChange(safeDefault);
  }, [commitImmediateChange, safeDefault]);

  return (
    <div
      data-testid="distance-filter-slider-container"
      className={cn(
        "space-y-3.5 p-4 bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200 dark:border-zinc-800",
        className,
      )}
    >
      {/* Header with Distance Readout and Any-Distance Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Navigation className="w-4 h-4" />
          </div>
          <div>
            <label
              htmlFor="distance-slider"
              className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300"
            >
              Maximum Distance
            </label>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Filter venues within radius of your location
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            data-testid="distance-readout"
            className={cn(
              "font-mono text-xs font-black px-2.5 py-1 rounded-lg border",
              isAnyDistance
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700"
                : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
            )}
          >
            {isAnyDistance ? "Any Distance" : `${internalValue} km`}
          </span>

          {!isAnyDistance && (
            <button
              type="button"
              data-testid="reset-distance-btn"
              onClick={() => commitImmediateChange(0)}
              title="Reset to any distance"
              aria-label="Reset distance filter to any distance"
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Interactive Range Slider */}
      <div
        className="space-y-1.5 pt-1"
        data-testid="distance-slider-container"
        onDoubleClick={handleResetToDefault}
      >
        <div
          className="relative flex items-center"
          data-testid="distance-slider-track"
          onDoubleClick={handleResetToDefault}
        >
          <input
            id="distance-slider"
            data-testid="distance-slider"
            type="range"
            min={safeMin}
            max={safeMax}
            step={safeStep}
            value={sliderDisplayValue}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
            onPointerUp={handleSliderCommit}
            onMouseUp={handleSliderCommit}
            onTouchEnd={handleSliderCommit}
            onKeyUp={handleSliderCommit}
            onDoubleClick={handleResetToDefault}
            aria-valuemin={safeMin}
            aria-valuemax={safeMax}
            aria-valuenow={isAnyDistance ? safeMin : internalValue}
            aria-label={`Distance filter slider (${safeMin}km to ${safeMax}km)`}
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>

        {/* Min / Max Labels */}
        <div className="flex justify-between text-[10px] font-mono font-bold text-zinc-400 select-none">
          <span>{safeMin} km</span>
          <span>10 km</span>
          <span>25 km</span>
          <span>{safeMax} km</span>
        </div>
      </div>

      {/* Quick Radius Preset Chips */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mr-1">
          Quick:
        </span>
        <button
          type="button"
          data-testid="preset-distance-any"
          onClick={() => commitImmediateChange(0)}
          className={cn(
            "px-2.5 py-1 rounded-xl text-xs font-bold transition-all",
            isAnyDistance
              ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
              : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-blue-400/50",
          )}
        >
          Any
        </button>
        {safePresets.map((p) => {
          const isSelected = !isAnyDistance && internalValue === p;
          return (
            <button
              key={p}
              type="button"
              data-testid={`preset-distance-${p}`}
              onClick={() => commitImmediateChange(p)}
              className={cn(
                "px-2.5 py-1 rounded-xl text-xs font-bold transition-all",
                isSelected
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
                  : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-blue-400/50",
              )}
            >
              {p} km
            </button>
          );
        })}
      </div>

      {/* Geolocation Status Indicator & Refresh */}
      {showLocationPrompt && (
        <div className="pt-1.5 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 truncate max-w-[280px]">
            <MapPin className="w-3.5 h-3.5 shrink-0 text-blue-500" />
            <span className="truncate">
              {localLocation
                ? `Active Location: (${localLocation.lat.toFixed(3)}, ${localLocation.lng.toFixed(3)})`
                : "Location not shared"}
            </span>
          </div>

          <button
            type="button"
            data-testid="get-current-location-btn"
            onClick={requestLocation}
            disabled={isLocating}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
          >
            <Locate className={cn("w-3.5 h-3.5", isLocating && "animate-spin")} />
            <span>{isLocating ? "Locating..." : localLocation ? "Update" : "Use My Location"}</span>
          </button>
        </div>
      )}

      {geoError && (
        <p
          data-testid="distance-geo-error"
          className="text-[11px] text-amber-600 dark:text-amber-400 pt-0.5"
        >
          {geoError}
        </p>
      )}
    </div>
  );
}

export default DistanceFilterSlider;
