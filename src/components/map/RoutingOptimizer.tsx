"use client";

import React, { forwardRef } from "react";
import { TrendingUp, Flame } from "lucide-react";
import {
  calculateElevationGain,
  calculateActiveCalories,
  formatElevation,
  formatCalories,
  normalizeTransportationMode,
  type TransportationMode,
} from "@/lib/routing/elevationCalculator";

export interface RouteLeg {
  distance?: number;
  duration?: number;
  summary?: string;
  [key: string]: any;
}

export interface OptimizedRouteData {
  distance?: number; // in meters
  duration?: number; // in seconds
  coordinates?: Array<
    | [number, number]
    | [number, number, number]
    | { lat: number; lng: number; elevation?: number; ele?: number; alt?: number }
  >;
  elevationProfile?: number[];
  elevationGain?: number | null;
  legs?: RouteLeg[];
  [key: string]: any;
}

export interface RoutingVenueItem {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  [key: string]: any;
}

export interface RouteSummaryCardProps {
  route?: OptimizedRouteData | null;
  mode?: TransportationMode;
  weightKg?: number;
  unitPreference?: "metric" | "imperial";
  className?: string;
}

/**
 * Route Summary Metric Card displaying:
 * - Distance (km or mi)
 * - Duration (mins)
 * - Elevation gain (m or ft, for WALK and BIKE, N/A for DRIVE)
 * - Estimated active calories burned (MET formula, for WALK and BIKE, N/A for DRIVE)
 */
export function RouteSummaryCard({
  route,
  mode = "walking",
  weightKg,
  unitPreference = "metric",
  className = "",
}: RouteSummaryCardProps) {
  if (!route) return null;

  const normalizedMode = normalizeTransportationMode(mode);

  // Distance formatting
  let formattedDistance = "N/A";
  if (typeof route.distance === "number" && Number.isFinite(route.distance) && route.distance >= 0) {
    if (unitPreference === "imperial") {
      formattedDistance = `${(route.distance / 1609.34).toFixed(2)} mi`;
    } else {
      formattedDistance = `${(route.distance / 1000).toFixed(2)} km`;
    }
  }

  // Duration formatting
  let formattedDuration = "N/A";
  if (typeof route.duration === "number" && Number.isFinite(route.duration) && route.duration >= 0) {
    const minutes = Math.round(route.duration / 60);
    formattedDuration = `${minutes} mins`;
  }

  // Elevation Gain
  let elevationGainMeters: number | null = null;
  if (normalizedMode !== "driving") {
    if (
      typeof route.elevationGain === "number" &&
      Number.isFinite(route.elevationGain) &&
      route.elevationGain >= 0
    ) {
      elevationGainMeters = route.elevationGain;
    } else if (route.elevationProfile || route.coordinates) {
      elevationGainMeters = calculateElevationGain(
        route.elevationProfile || (route.coordinates as any),
      );
    }
  }

  const elevationDisplay =
    normalizedMode === "driving"
      ? "N/A"
      : elevationGainMeters !== null
        ? formatElevation(elevationGainMeters, unitPreference)
        : "N/A";

  // Active Calories Burned
  let activeCalories: number | null = null;
  if (normalizedMode !== "driving") {
    activeCalories = calculateActiveCalories({
      mode: normalizedMode,
      durationSeconds: route.duration,
      weightKg,
      elevationGainMeters,
      distanceMeters: route.distance,
      includeGradientAdjustment: true,
    });
  }

  const calorieDisplay =
    normalizedMode === "driving"
      ? "N/A"
      : activeCalories !== null
        ? formatCalories(activeCalories)
        : "N/A";

  return (
    <div
      data-testid="route-summary-card"
      className={`mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-400 space-y-1.5 ${className}`}
    >
      <div className="flex items-center justify-between">
        <span>Total Distance:</span>
        <span data-testid="metric-distance" className="font-semibold text-zinc-200">
          {formattedDistance}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span>Est. Transit Time:</span>
        <span data-testid="metric-duration" className="font-semibold text-zinc-200">
          {formattedDuration}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-zinc-300">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
          Elevation Gain:
        </span>
        <span
          data-testid="metric-elevation"
          className={`font-semibold ${
            elevationDisplay === "N/A" ? "text-zinc-500" : "text-emerald-300"
          }`}
        >
          {elevationDisplay}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-zinc-300">
          <Flame className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          Est. Calories:
        </span>
        <span
          data-testid="metric-calories"
          className={`font-semibold ${
            calorieDisplay === "N/A" ? "text-zinc-500" : "text-amber-300"
          }`}
        >
          {calorieDisplay}
        </span>
      </div>
    </div>
  );
}

export interface RoutingOptimizerProps {
  routingQueue?: RoutingVenueItem[];
  onClearQueue?: () => void;
  onRemoveVenue?: (index: number) => void;
  travelProfile?: TransportationMode;
  onTravelProfileChange?: (mode: "walking" | "cycling" | "driving") => void;
  onCalculateRoute?: () => void;
  optimizedRoute?: OptimizedRouteData | null;
  weightKg?: number;
  unitPreference?: "metric" | "imperial";
  className?: string;
}

/**
 * RoutingOptimizer Control Interface Overlay & Route Summary Component
 */
export const RoutingOptimizer = forwardRef<HTMLDivElement, RoutingOptimizerProps>(
  function RoutingOptimizer(
    {
      routingQueue = [],
      onClearQueue,
      onRemoveVenue,
      travelProfile = "walking",
      onTravelProfileChange,
      onCalculateRoute,
      optimizedRoute,
      weightKg,
      unitPreference = "metric",
      className = "",
    },
    ref,
  ) {
    const currentMode = normalizeTransportationMode(travelProfile);

    const modeAriaLabels: Record<"walking" | "cycling" | "driving", string> = {
      walking: "Select walking route mode",
      cycling: "Select biking route mode",
      driving: "Select driving route mode",
    };

    return (
      <div
        ref={ref}
        data-testid="routing-optimizer"
        className={`absolute bottom-6 left-6 z-[1000] w-80 rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 text-white shadow-2xl backdrop-blur-md ${className}`}
      >
        <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
          <h3 className="font-semibold text-sm tracking-wide text-zinc-200">
            📍 ROUTING OPTIMIZER
          </h3>
          {routingQueue.length > 0 && onClearQueue && (
            <button
              onClick={onClearQueue}
              className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded"
            >
              Clear Queue
            </button>
          )}
        </div>

        {/* Travel Mode Selectors */}
        <div
          className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-zinc-900 p-1 text-xs"
          role="group"
          aria-label="Travel mode selection"
        >
          {(["walking", "cycling", "driving"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onTravelProfileChange?.(mode)}
              aria-label={modeAriaLabels[mode]}
              aria-pressed={currentMode === mode}
              className={`rounded-md py-1.5 font-medium cursor-pointer uppercase transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                currentMode === mode
                  ? "accent-bg text-white shadow"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {mode === "walking"
                ? "🚶‍♂️ Walk"
                : mode === "cycling"
                  ? "🚴‍♂️ Bike"
                  : "🚗 Drive"}
            </button>
          ))}
        </div>

        {/* Queue Timeline Slots */}
        {routingQueue.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
            Click markers or venue listings to chain multiple destinations
            into your hybrid workday route!
          </div>
        ) : (
          <div className="space-y-2">
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {routingQueue.map((venue, idx) => (
                <div
                  key={venue.id || idx}
                  className="flex items-center justify-between rounded-lg bg-zinc-900 p-2 text-xs border border-zinc-800"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-950 text-[10px] font-bold text-blue-400 border border-blue-800/50">
                      {idx + 1}
                    </span>
                    <span className="truncate font-medium text-zinc-300">
                      {venue.name}
                    </span>
                  </div>
                  {onRemoveVenue && (
                    <button
                      onClick={() => onRemoveVenue(idx)}
                      className="ml-2 text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded"
                      aria-label={`Remove ${venue.name} from route`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Optimize Trigger Action Button */}
            {routingQueue.length >= 2 && onCalculateRoute && (
              <button
                onClick={onCalculateRoute}
                className="mt-3 w-full rounded-lg py-2 text-xs font-semibold text-white shadow-lg transition-all active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                style={{
                  background: `linear-gradient(to right, var(--primary-accent), color-mix(in srgb, var(--primary-accent) 80%, #4f46e5))`,
                }}
              >
                🚀 Calculate Combined Travel Timeline
              </button>
            )}
          </div>
        )}

        {/* Dynamic Journey Metric Matrix Summary Card */}
        {optimizedRoute && (
          <RouteSummaryCard
            route={optimizedRoute}
            mode={travelProfile}
            weightKg={weightKg}
            unitPreference={unitPreference}
          />
        )}
      </div>
    );
  },
);

export default RoutingOptimizer;