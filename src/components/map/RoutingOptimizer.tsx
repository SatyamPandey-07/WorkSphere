"use client";

import React, { forwardRef, useState, useEffect } from "react";
import { TrendingUp, Flame, GripVertical, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { Reorder } from "framer-motion";
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
  isLoading?: boolean;
  error?: string | null;
  stopCount?: number;
}

/**
 * Route Summary Metric Card displaying:
 * - Number of route stops
 * - Total walking/travel distance (km or mi)
 * - Estimated transit time (mins)
 * - Elevation gain (m or ft, for WALK and BIKE, N/A for DRIVE)
 * - Estimated active calories burned (MET formula, for WALK and BIKE, N/A for DRIVE)
 */
export function RouteSummaryCard({
  route,
  mode = "walking",
  weightKg,
  unitPreference = "metric",
  className = "",
  isLoading = false,
  error = null,
  stopCount,
}: RouteSummaryCardProps) {
  if (error) {
    return (
      <div
        data-testid="route-summary-error"
        className={`mt-3 border-t border-red-900/40 pt-3 text-xs text-red-400 ${className}`}
      >
        <span className="font-medium">{error}</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        data-testid="route-summary-loading"
        className={`mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-400 flex items-center justify-center gap-2 py-2 ${className}`}
      >
        <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
        <span>Recalculating route metrics...</span>
      </div>
    );
  }

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
    formattedDuration = `${minutes} min${minutes === 1 ? "" : "s"}`;
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
      {typeof stopCount === "number" && (
        <div className="flex items-center justify-between">
          <span>Stops:</span>
          <span data-testid="metric-stops" className="font-semibold text-zinc-200">
            {stopCount} {stopCount === 1 ? "stop" : "stops"}
          </span>
        </div>
      )}
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
  onReorderWaypoints?: (newQueue: RoutingVenueItem[]) => void;
  travelProfile?: TransportationMode;
  onTravelProfileChange?: (mode: "walking" | "cycling" | "driving") => void;
  onCalculateRoute?: () => void;
  optimizedRoute?: OptimizedRouteData | null;
  weightKg?: number;
  unitPreference?: "metric" | "imperial";
  className?: string;
  isLoading?: boolean;
  routingError?: string | null;
  // Backwards compatibility props
  activeMode?: string;
  onModeChange?: (mode: string) => void;
}

/**
 * RoutingOptimizer Control Interface Overlay & Route Summary Component
 * Supports smooth drag-and-drop waypoint reordering with immediate route recalculation.
 */
export const RoutingOptimizer = forwardRef<HTMLDivElement, RoutingOptimizerProps>(
  function RoutingOptimizer(
    {
      routingQueue = [],
      onClearQueue,
      onRemoveVenue,
      onReorderWaypoints,
      travelProfile = "walking",
      onTravelProfileChange,
      onCalculateRoute,
      optimizedRoute,
      weightKg,
      unitPreference = "metric",
      className = "",
      isLoading = false,
      routingError = null,
      activeMode,
      onModeChange,
    },
    ref,
  ) {
    // Map activeMode <-> travelProfile for seamless backwards compatibility
    const effectiveTravelProfile =
      travelProfile ||
      (activeMode === "walk"
        ? "walking"
        : activeMode === "bike"
          ? "cycling"
          : activeMode === "drive"
            ? "driving"
            : "walking");

    const currentMode = normalizeTransportationMode(effectiveTravelProfile);

    // Keep internal ordered queue synchronized with incoming routingQueue prop
    const [orderedQueue, setOrderedQueue] = useState<RoutingVenueItem[]>(routingQueue);

    useEffect(() => {
      setOrderedQueue(routingQueue);
    }, [routingQueue]);

    const handleModeSelect = (mode: "walking" | "cycling" | "driving") => {
      if (isLoading) return;
      onTravelProfileChange?.(mode);

      // Backwards-compatible mode callback
      if (onModeChange) {
        const legacyMode = mode === "walking" ? "walk" : mode === "cycling" ? "bike" : "drive";
        onModeChange(legacyMode);
      }
    };

    const handleModeKeyDown = (
      e: React.KeyboardEvent,
      mode: "walking" | "cycling" | "driving",
    ) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleModeSelect(mode);
      }
    };

    // Accessible keyboard move helpers
    const handleMoveWaypoint = (fromIdx: number, toIdx: number) => {
      if (toIdx < 0 || toIdx >= orderedQueue.length || fromIdx === toIdx) return;
      const updated = [...orderedQueue];
      const [movedItem] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, movedItem);
      setOrderedQueue(updated);
      onReorderWaypoints?.(updated);
    };

    const modeAriaLabels: Record<"walking" | "cycling" | "driving", string> = {
      walking: "Select walking route mode",
      cycling: "Select biking route mode (Bike)",
      driving: "Select driving route mode (Drive)",
    };

    return (
      <div
        ref={ref}
        data-testid="routing-optimizer"
        className={`absolute bottom-6 left-6 z-[1000] w-80 rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 text-white shadow-2xl backdrop-blur-md ${className}`}
      >
        <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm tracking-wide text-zinc-200">
              📍 ROUTING OPTIMIZER
            </h3>
            {isLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
            )}
          </div>
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
          {(["walking", "cycling", "driving"] as const).map((mode) => {
            const isSelected = currentMode === mode;
            return (
              <button
                key={mode}
                type="button"
                disabled={isLoading}
                onClick={() => handleModeSelect(mode)}
                onKeyDown={(e) => handleModeKeyDown(e, mode)}
                aria-label={modeAriaLabels[mode]}
                aria-pressed={isSelected}
                className={`rounded-md py-1.5 font-medium cursor-pointer uppercase transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  isLoading ? "opacity-50 cursor-not-allowed" : ""
                } ${
                  isSelected
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
            );
          })}
        </div>

        {/* Queue Timeline Slots */}
        {routingQueue.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
            Click markers or venue listings to chain multiple destinations
            into your hybrid workday route!
          </div>
        ) : (
          <div className="space-y-2">
            <Reorder.Group
              axis="y"
              values={orderedQueue}
              onReorder={(newQueue) => {
                setOrderedQueue(newQueue);
                onReorderWaypoints?.(newQueue);
              }}
              data-testid="reorder-queue-group"
              className="max-h-48 overflow-y-auto space-y-1.5 pr-1 list-none p-0 m-0"
              style={{ touchAction: "none" }}
            >
              {orderedQueue.map((venue, idx) => {
                const itemKey = venue.id || `${venue.name}-${venue.latitude}-${venue.longitude}-${idx}`;
                return (
                  <Reorder.Item
                    key={itemKey}
                    value={venue}
                    id={itemKey}
                    data-testid={`waypoint-item-${idx}`}
                    className="flex items-center justify-between rounded-lg bg-zinc-900 p-2 text-xs border border-zinc-800 cursor-grab active:cursor-grabbing hover:border-zinc-700 transition-colors shadow-sm select-none"
                    whileDrag={{
                      scale: 1.02,
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
                      borderColor: "var(--primary-accent, #3b82f6)",
                      zIndex: 50,
                    }}
                  >
                    <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                      {/* Drag Affordance Handle */}
                      <span
                        className="text-zinc-500 hover:text-zinc-300 cursor-grab active:cursor-grabbing shrink-0"
                        aria-label={`Drag handle for stop ${idx + 1}: ${venue.name}`}
                        title="Drag to reorder stop"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>

                      {/* Stop Sequence Number Badge */}
                      <span
                        data-testid={`stop-index-${idx}`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-950 text-[10px] font-bold text-blue-400 border border-blue-800/50"
                      >
                        {idx + 1}
                      </span>

                      <span className="truncate font-medium text-zinc-300">
                        {venue.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {/* Accessible Keyboard Reorder Buttons */}
                      <button
                        type="button"
                        disabled={idx === 0 || isLoading}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveWaypoint(idx, idx - 1);
                        }}
                        aria-label={`Move ${venue.name} up`}
                        title="Move up"
                        className="p-0.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 disabled:pointer-events-none rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === orderedQueue.length - 1 || isLoading}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveWaypoint(idx, idx + 1);
                        }}
                        aria-label={`Move ${venue.name} down`}
                        title="Move down"
                        className="p-0.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 disabled:pointer-events-none rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>

                      {/* Remove Stop Button */}
                      {onRemoveVenue && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveVenue(idx);
                          }}
                          className="ml-1 text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded px-1"
                          aria-label={`Remove ${venue.name} from route`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>

            {/* Optimize Trigger Action Button */}
            {routingQueue.length >= 2 && onCalculateRoute && (
              <button
                onClick={onCalculateRoute}
                disabled={isLoading}
                className="mt-3 w-full rounded-lg py-2 text-xs font-semibold text-white shadow-lg transition-all active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(to right, var(--primary-accent), color-mix(in srgb, var(--primary-accent) 80%, #4f46e5))`,
                }}
              >
                {isLoading ? "Recalculating Route..." : "🚀 Calculate Combined Travel Timeline"}
              </button>
            )}
          </div>
        )}

        {/* Dynamic Journey Metric Matrix Summary Card */}
        {(optimizedRoute || isLoading || routingError) && (
          <RouteSummaryCard
            route={optimizedRoute}
            mode={travelProfile}
            weightKg={weightKg}
            unitPreference={unitPreference}
            isLoading={isLoading}
            error={routingError}
            stopCount={routingQueue.length}
          />
        )}
      </div>
    );
  },
);

export default RoutingOptimizer;
