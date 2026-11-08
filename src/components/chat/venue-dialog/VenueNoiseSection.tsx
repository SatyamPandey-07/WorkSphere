"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Wifi, Zap, Volume2, Sun, Info } from "lucide-react";
import type { Venue } from "../ChatMessages";
import { RatingDistribution } from "../RatingDistribution";
import { NoiseReportingWidget } from "@/components/noise/NoiseReportingWidget";
import { AmbientNoiseSpectrumVisualizer } from "@/components/noise/AmbientNoiseSpectrumVisualizer";
import { AudioEqualizer } from "@/components/audio/AudioEqualizer";
import type { HourlyForecast } from "@/components/noise/NoiseTimelineChart";
import { AmbientNoiseTrendGraph } from "@/components/noise/AmbientNoiseTrendGraph";

const VenueNoiseChart = dynamic(
  () =>
    import("../VenueNoiseChart").then(
      (mod) => mod.VenueNoiseChart ?? mod.default,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-40 animate-pulse bg-black/20 rounded-2xl mb-6 border border-white/5" />
    ),
  },
);

const NoiseTimelineChart = dynamic(
  () =>
    import("@/components/noise/NoiseTimelineChart").then(
      (mod) => mod.NoiseTimelineChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-40 animate-pulse bg-black/20 rounded-2xl mb-6 border border-white/5" />
    ),
  },
);

export interface VenueNoiseSectionProps {
  venue: Venue;
  reviews?: any[];
  wifiPredictions?: any[];
  occupancyData?: any[];
  noiseForecast?: HourlyForecast[];
  activeDistribution?: "wifi" | "outlets" | "noise" | null;
  setActiveDistribution?: (dist: "wifi" | "outlets" | "noise" | null) => void;
}

export function VenueNoiseSection({
  venue,
  reviews = [],
  wifiPredictions = [],
  occupancyData = [],
  noiseForecast = [],
  activeDistribution = null,
  setActiveDistribution = () => {},
}: VenueNoiseSectionProps) {
  const safeReviews = Array.isArray(reviews) ? reviews : [];
  const safeWifiPredictions = Array.isArray(wifiPredictions)
    ? wifiPredictions
    : [];
  const safeOccupancyData = Array.isArray(occupancyData) ? occupancyData : [];
  const safeNoiseForecast = Array.isArray(noiseForecast) ? noiseForecast : [];
  const safeVenue = venue || ({} as Partial<Venue>);

  const formattedOutletDensity = (() => {
    if (
      typeof safeVenue.outletDensity === "string" &&
      safeVenue.outletDensity !== "none"
    ) {
      return safeVenue.outletDensity
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
    }
    return safeVenue.hasOutlets ? "Yes" : "No";
  })();

  const formattedLighting = (() => {
    if (typeof safeVenue.lighting === "string") {
      return safeVenue.lighting.replace(/_/g, " ");
    }
    return "Normal";
  })();

  const safeOutletLocations = Array.isArray(safeVenue.outletLocations)
    ? safeVenue.outletLocations.filter(
        (loc): loc is string => typeof loc === "string" && loc.trim().length > 0,
      )
    : [];

  return (
    <>
      {/* 4-Box Quick Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <button
          type="button"
          onClick={() =>
            setActiveDistribution?.(
              activeDistribution === "wifi" ? null : "wifi",
            )
          }
          aria-pressed={activeDistribution === "wifi"}
          aria-label="Toggle WiFi rating distribution"
          data-testid="venue-noise-metric-wifi"
          className={`p-5 rounded-2xl flex flex-col items-center text-center border transition-all ${
            activeDistribution === "wifi"
              ? "bg-blue-500/20 border-blue-500 shadow-md ring-2 ring-blue-500/20 scale-95"
              : "bg-black/20 border-white/5 hover:bg-black/40 hover:border-white/10 hover:scale-[1.02] cursor-pointer"
          }`}
        >
          <div className="p-3 rounded-xl bg-blue-500/20 mb-3">
            <Wifi className="w-6 h-6 text-blue-400" />
          </div>
          <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">
            WiFi
          </span>
          <span className="text-xl font-black text-white leading-none">
            {safeVenue.wifiSpeed
              ? `${safeVenue.wifiSpeed}M`
              : `${safeVenue.wifiQuality || 4}/5`}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveDistribution?.(
              activeDistribution === "outlets" ? null : "outlets",
            )
          }
          aria-pressed={activeDistribution === "outlets"}
          aria-label="Toggle outlets and power rating distribution"
          data-testid="venue-noise-metric-power"
          className={`p-5 rounded-2xl flex flex-col items-center text-center border transition-all ${
            activeDistribution === "outlets"
              ? "bg-orange-500/20 border-orange-500 shadow-md ring-2 ring-orange-500/20 scale-95"
              : "bg-black/20 border-white/5 hover:bg-black/40 hover:border-white/10 hover:scale-[1.02] cursor-pointer"
          }`}
        >
          <div className="p-3 rounded-xl bg-orange-500/20 mb-3">
            <Zap className="w-6 h-6 text-orange-400" />
          </div>
          <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">
            Power
          </span>
          <span className="text-xl font-black text-white leading-none uppercase tracking-wide">
            {formattedOutletDensity}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveDistribution?.(
              activeDistribution === "noise" ? null : "noise",
            )
          }
          aria-pressed={activeDistribution === "noise"}
          aria-label="Toggle noise rating distribution"
          data-testid="venue-noise-metric-noise"
          className={`p-5 rounded-2xl flex flex-col items-center text-center border transition-all ${
            activeDistribution === "noise"
              ? "bg-pink-500/20 border-pink-500 shadow-md ring-2 ring-pink-500/20 scale-95"
              : "bg-black/20 border-white/5 hover:bg-black/40 hover:border-white/10 hover:scale-[1.02] cursor-pointer"
          }`}
        >
          <div className="p-3 rounded-xl bg-pink-500/20 mb-3">
            <Volume2 className="w-6 h-6 text-pink-400" />
          </div>
          <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">
            Noise
          </span>
          <span className="text-xl font-black text-white leading-none capitalize">
            {safeVenue.noiseLevel || "Normal"}
          </span>
        </button>

        <div
          data-testid="venue-noise-metric-lighting"
          className="bg-black/20 p-5 rounded-2xl flex flex-col items-center text-center border border-white/5"
        >
          <div className="p-3 rounded-xl bg-amber-500/20 mb-3">
            <Sun className="w-6 h-6 text-amber-400" />
          </div>
          <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">
            Lighting
          </span>
          <span className="text-xl font-black text-white leading-none capitalize text-center leading-tight">
            {formattedLighting}
          </span>
        </div>
      </div>

      {activeDistribution && (
        <div className="mb-6" data-testid="venue-rating-distribution-container">
          <RatingDistribution
            reviews={safeReviews}
            activeMetric={activeDistribution}
            venueName={safeVenue.name || "Workspace"}
            onClose={() => setActiveDistribution?.(null)}
          />
        </div>
      )}

      {/* Ambient Noise Spectrum Frequency Visualization */}
      <div className="mb-6" data-testid="ambient-noise-spectrum-container">
        <AmbientNoiseSpectrumVisualizer
          venueId={safeVenue.id || "venue-default"}
          venueName={safeVenue.name || "Workspace"}
          noiseLevel={safeVenue.noiseLevel}
        />
      </div>

      {/* Noise Reporting Widget */}
      <div className="mb-6" data-testid="noise-reporting-container">
        <NoiseReportingWidget
          venueId={safeVenue.id || "venue-default"}
          venueName={safeVenue.name || "Workspace"}
        />
      </div>

      {/* WiFi & Occupancy Noise Chart */}
      <VenueNoiseChart
        wifiPredictions={safeWifiPredictions}
        occupancyData={safeOccupancyData}
      />

      {/* 24-Hour Forecast Graphs */}
      {safeNoiseForecast.length > 0 && (
        <div data-testid="noise-forecast-graphs-container">
          <AmbientNoiseTrendGraph
            venueId={safeVenue.id || "venue-default"}
            forecast={safeNoiseForecast}
          />
          <NoiseTimelineChart forecast={safeNoiseForecast} />
        </div>
      )}

      {/* Audio Equalizer and Intelligence Brief */}
      <div className="space-y-6 mt-6" data-testid="audio-equalizer-container">
        <AudioEqualizer venueName={safeVenue.name || "Workspace"} />

        <div
          className="accent-bg-10 p-5 rounded-2xl border accent-border-30"
          data-testid="venue-intelligence-brief"
        >
          <h3 className="text-xs font-black uppercase tracking-widest accent-text mb-2 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Intelligence Brief
          </h3>
          <p className="text-zinc-200 text-sm leading-relaxed font-medium">
            Analysis based on Multi-Agent telemetry suggests this{" "}
            {safeVenue.category || "workspace"} is optimal for{" "}
            {safeVenue.category === "cafe"
              ? "collaborative sessions"
              : "high-focus work"}
            . Noise floor is {safeVenue.noiseLevel || "ambient"} and connectivity is
            verified as {safeVenue.wifi ? "stable" : "pending"}.
            {safeVenue.hasErgonomic &&
              " The workspace features verified ergonomic chairs and height-adjustable/standing desks."}
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {safeVenue.musicStyle === "lofi" && (
              <div
                data-testid="badge-music-lofi"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold"
              >
                <span>🎵 Lo-Fi/Chill Beats</span>
              </div>
            )}
            {safeVenue.musicStyle === "classical_jazz" && (
              <div
                data-testid="badge-music-classical-jazz"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold"
              >
                <span>🎷 Classical/Jazz Background</span>
              </div>
            )}
            {(safeVenue.musicStyle === "no_music" || safeVenue.hasNoMusic) && (
              <div
                data-testid="badge-music-no-music"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold"
              >
                <span>🔇 No Music Played</span>
              </div>
            )}
            {safeVenue.hasPhoneBooths && (
              <div
                data-testid="badge-phone-booths"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold"
              >
                <span>📞 Soundproof Booths Available</span>
              </div>
            )}
            {safeOutletLocations.length > 0 && (
              <div
                data-testid="badge-outlet-locations"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold"
              >
                <span>
                  🔌 Outlets:{" "}
                  {safeOutletLocations
                    .map((l) => l.replace(/_/g, " "))
                    .join(", ")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default VenueNoiseSection;
