"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Navigation, MapPin, Locate, RotateCcw, Check } from "lucide-react";

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
  className = "",
  showLocationPrompt = true,
}: DistanceFilterSliderProps) {
  const [localLocation, setLocalLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(propUserLocation);
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Sync prop location
  useEffect(() => {
    if (propUserLocation) {
      setLocalLocation(propUserLocation);
    }
  }, [propUserLocation]);

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

  const isAnyDistance = value === 0 || value < min;
  const sliderDisplayValue = isAnyDistance ? min : value;

  // Reset to default radius (default 10km) on double-click (#5026)
  const handleResetToDefault = useCallback(() => {
    onChange(defaultValue);
  }, [onChange, defaultValue]);

  return (
    <div
      data-testid="distance-filter-slider-container"
      className={`space-y-3.5 p-4 bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200 dark:border-zinc-800 ${className}`}
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
            className={`font-mono text-xs font-black px-2.5 py-1 rounded-lg border ${
              isAnyDistance
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700"
                : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
            }`}
          >
            {isAnyDistance ? "Any Distance" : `${value} km`}
          </span>

          {!isAnyDistance && (
            <button
              type="button"
              data-testid="reset-distance-btn"
              onClick={() => onChange(0)}
              title="Reset to any distance"
              aria-label="Reset distance filter to any distance"
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Interactive Range Slider (1km to 50km) */}
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
            min={min}
            max={max}
            step={step}
            value={sliderDisplayValue}
            onChange={(e) => onChange(Number(e.target.value))}
            onDoubleClick={handleResetToDefault}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={isAnyDistance ? min : value}
            aria-label="Distance filter slider (1km to 50km)"
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>

        {/* Min / Max Labels */}
        <div className="flex justify-between text-[10px] font-mono font-bold text-zinc-400 select-none">
          <span>{min} km</span>
          <span>10 km</span>
          <span>25 km</span>
          <span>{max} km</span>
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
          onClick={() => onChange(0)}
          className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
            isAnyDistance
              ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
              : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-blue-400/50"
          }`}
        >
          Any
        </button>
        {presets.map((p) => {
          const isSelected = !isAnyDistance && value === p;
          return (
            <button
              key={p}
              type="button"
              data-testid={`preset-distance-${p}`}
              onClick={() => onChange(p)}
              className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
                isSelected
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
                  : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-blue-400/50"
              }`}
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
            <Locate className={`w-3.5 h-3.5 ${isLocating ? "animate-spin" : ""}`} />
            <span>{isLocating ? "Locating..." : localLocation ? "Update" : "Use My Location"}</span>
          </button>
        </div>
      )}

      {geoError && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-0.5">
          {geoError}
        </p>
      )}
    </div>
  );
}
