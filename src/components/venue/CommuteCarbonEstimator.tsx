"use client";

import { useState } from "react";
import {
  Leaf,
  Clock,
  Trees,
  Flame,
  TrendingDown,
  Navigation,
  Info,
  Calendar,
} from "lucide-react";
import { useCommuteEstimator } from "@/hooks/useCommuteEstimator";
import { COMMUTE_MODES, type CommuteMode } from "@/lib/commute/carbonEstimator";
import { cn } from "@/lib/utils";

export interface CommuteCarbonEstimatorProps {
  venueLatitude: number;
  venueLongitude: number;
  venueName?: string;
  className?: string;
}

export function CommuteCarbonEstimator({
  venueLatitude,
  venueLongitude,
  venueName,
  className = "",
}: CommuteCarbonEstimatorProps) {
  const {
    activeMode,
    setActiveMode,
    activeEstimate,
    allEstimates,
    isLoadingLocation,
    requestCurrentLocation,
    showWeeklyProjection,
    setShowWeeklyProjection,
  } = useCommuteEstimator({
    venueLatitude,
    venueLongitude,
    venueName,
  });

  const [expandedInfo, setExpandedInfo] = useState(false);

  if (!activeEstimate || !allEstimates) {
    return null;
  }

  const modes: CommuteMode[] = ["walking", "cycling", "transit", "ev", "motorcycle", "car"];

  return (
    <div
      data-testid="commute-carbon-estimator"
      className={cn(
        "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 shadow-sm overflow-hidden p-5 sm:p-6 space-y-5 transition-all",
        className
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800/80 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Leaf className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              Commute &amp; Carbon Footprint
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Multimodal travel times, CO₂ emissions, and tree offsets
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="request-location-btn"
            onClick={requestCurrentLocation}
            disabled={isLoadingLocation}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
            title="Recalculate distance from your current GPS coordinates"
          >
            <Navigation
              className={`h-3.5 w-3.5 text-emerald-500 ${
                isLoadingLocation ? "animate-spin" : ""
              }`}
            />
            <span className="hidden sm:inline">My Location</span>
          </button>

          <button
            type="button"
            data-testid="projection-toggle-btn"
            onClick={() => setShowWeeklyProjection(!showWeeklyProjection)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-all ${
              showWeeklyProjection
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : "bg-zinc-50 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:text-zinc-900 dark:hover:text-white"
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            <span>{showWeeklyProjection ? "5-Day Impact" : "Daily Trip"}</span>
          </button>
        </div>
      </div>

      {/* Mode Selector Tabs */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {modes.map((modeKey) => {
          const modeInfo = COMMUTE_MODES[modeKey];
          const est = allEstimates[modeKey];
          const isSelected = activeMode === modeKey;

          return (
            <button
              key={modeKey}
              type="button"
              data-testid={`commute-mode-btn-${modeKey}`}
              onClick={() => setActiveMode(modeKey)}
              className={cn(
                "flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all cursor-pointer",
                isSelected
                  ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/60 ring-2 ring-emerald-500/20 shadow-sm"
                  : "bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700"
              )}
            >
              <span className="text-xl mb-1">{modeInfo.icon}</span>
              <span
                className={`text-xs font-semibold truncate max-w-full ${
                  isSelected
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {modeInfo.label.split("/")[0]}
              </span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">
                {est.durationFormatted}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Mode Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Metric 1: Travel Time & Distance */}
        <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 p-3.5 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Clock className="h-3.5 w-3.5 text-blue-500" />
            <span>Estimated Travel Time</span>
          </div>
          <div
            data-testid="commute-travel-time"
            className="text-xl font-bold text-zinc-900 dark:text-white"
          >
            {activeEstimate.durationFormatted}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            {activeEstimate.distanceKm} km · One-way
          </div>
        </div>

        {/* Metric 2: CO2 Footprint */}
        <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 p-3.5 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Leaf className="h-3.5 w-3.5 text-emerald-500" />
            <span>
              {showWeeklyProjection ? "5-Day Weekly CO₂" : "Round-Trip CO₂"}
            </span>
          </div>
          <div
            data-testid="commute-co2-metric"
            className="text-xl font-bold text-zinc-900 dark:text-white"
          >
            {showWeeklyProjection
              ? `${activeEstimate.co2KgWeekly} kg`
              : `${activeEstimate.co2GramsRoundTrip}g`}
          </div>
          <div className="flex items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border",
                activeEstimate.ecoColorClass
              )}
            >
              {activeEstimate.ecoBadgeText}
            </span>
          </div>
        </div>

        {/* Metric 3: Active Health / Carbon Savings */}
        <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 p-3.5 space-y-1">
          {activeEstimate.caloriesBurnedRoundTrip > 0 ? (
            <>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <Flame className="h-3.5 w-3.5 text-amber-500" />
                <span>Active Calorie Burn</span>
              </div>
              <div
                data-testid="commute-active-health-metric"
                className="text-xl font-bold text-amber-600 dark:text-amber-400"
              >
                {showWeeklyProjection
                  ? `${activeEstimate.caloriesBurnedRoundTrip * 5} kcal`
                  : `${activeEstimate.caloriesBurnedRoundTrip} kcal`}
              </div>
              <div className="text-[11px] text-zinc-500">
                {showWeeklyProjection
                  ? "5-day daily commute burn"
                  : "Daily roundtrip active burn"}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <TrendingDown className="h-3.5 w-3.5 text-teal-500" />
                <span>Annual CO₂ Savings vs. Car</span>
              </div>
              <div
                data-testid="commute-active-health-metric"
                className="text-xl font-bold text-teal-600 dark:text-teal-400"
              >
                {activeEstimate.co2SavedVsCarAnnualKg > 0
                  ? `${activeEstimate.co2SavedVsCarAnnualKg} kg`
                  : "0 kg (Baseline)"}
              </div>
              <div className="text-[11px] text-zinc-500">
                {activeEstimate.co2SavedVsCarAnnualKg > 0
                  ? "Saved by avoiding driving"
                  : "Combustion baseline"}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Environmental Offset Banner */}
      {activeEstimate.co2SavedVsCarAnnualKg > 0 && (
        <div
          data-testid="carbon-offset-banner"
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-950/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <Trees className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Carbon Offset Impact
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Commuting via{" "}
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {activeEstimate.modeLabel}
                </span>{" "}
                saves{" "}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {activeEstimate.co2SavedVsCarAnnualKg} kg CO₂/yr
                </span>
                —equivalent to planting{" "}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {activeEstimate.equivalentTreesPlanted} trees
                </span>
                .
              </p>
            </div>
          </div>

          <div className="shrink-0">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <span>{activeEstimate.ecoScorePercentage}% Eco Efficiency</span>
            </div>
            <div className="h-1.5 w-32 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden mt-1">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                style={{ width: `${activeEstimate.ecoScorePercentage}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Detailed calculation method toggle */}
      <div className="pt-1">
        <button
          type="button"
          data-testid="calculation-info-toggle"
          onClick={() => setExpandedInfo(!expandedInfo)}
          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <Info className="h-3 w-3" />
          <span>{expandedInfo ? "Hide emission calculation details" : "How is this calculated?"}</span>
        </button>

        {expandedInfo && (
          <p
            data-testid="calculation-info-text"
            className="mt-2 text-[11px] text-zinc-500 leading-relaxed rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-3 border border-zinc-100 dark:border-zinc-800"
          >
            Emissions are calculated using standard DEFRA/EPA lifecycle emissions factors: Walking (0g CO₂/km), Cycling (4g CO₂/km), Public Transit (32g CO₂/km), EV (48g CO₂/km), Motorcycle (92g CO₂/km), and Average Gasoline Car baseline (171g CO₂/km). Annual tree offsets are based on mature tree absorption of 21.77 kg CO₂/year.
          </p>
        )}
      </div>
    </div>
  );
}

export default CommuteCarbonEstimator;
