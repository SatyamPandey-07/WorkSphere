"use client";

import React from "react";
import dynamic from "next/dynamic";
import {
  Wifi,
  Zap,
  Volume2,
  Sun,
  Info,
} from "lucide-react";
import type { Venue } from "../ChatMessages";
import { RatingDistribution } from "../RatingDistribution";
import { NoiseReportingWidget } from "@/components/noise/NoiseReportingWidget";
import { AmbientNoiseSpectrumVisualizer } from "@/components/noise/AmbientNoiseSpectrumVisualizer";
import { AudioEqualizer } from "@/components/audio/AudioEqualizer";
import type { HourlyForecast } from "@/components/noise/NoiseTimelineChart";

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
      (mod) => mod.NoiseTimelineChart ?? mod.default,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-40 animate-pulse bg-black/20 rounded-2xl mb-6 border border-white/5" />
    ),
  },
);

import { AmbientNoiseTrendGraph } from "@/components/noise/AmbientNoiseTrendGraph";

export interface VenueNoiseSectionProps {
  venue: Venue;
  reviews: any[];
  wifiPredictions: any[];
  occupancyData: any[];
  noiseForecast: HourlyForecast[];
  activeDistribution: "wifi" | "outlets" | "noise" | null;
  setActiveDistribution: (dist: "wifi" | "outlets" | "noise" | null) => void;
}

export function VenueNoiseSection({
  venue,
  reviews,
  wifiPredictions,
  occupancyData,
  noiseForecast,
  activeDistribution,
  setActiveDistribution,
}: VenueNoiseSectionProps) {
  return (
    <>
      {/* 4-Box Quick Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <button
          type="button"
          onClick={() =>
            setActiveDistribution(
              activeDistribution === "wifi" ? null : "wifi",
            )
          }
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
            {venue.wifiSpeed ? `${venue.wifiSpeed}M` : `${venue.wifiQuality || 4}/5`}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveDistribution(
              activeDistribution === "outlets" ? null : "outlets",
            )
          }
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
            {venue.outletDensity && venue.outletDensity !== "none"
              ? venue.outletDensity
                  .replace("_", " ")
                  .replace(/\b\w/g, (c: string) => c.toUpperCase())
              : venue.hasOutlets
                ? "Yes"
                : "No"}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveDistribution(
              activeDistribution === "noise" ? null : "noise",
            )
          }
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
            {venue.noiseLevel || "Normal"}
          </span>
        </button>

        <div className="bg-black/20 p-5 rounded-2xl flex flex-col items-center text-center border border-white/5">
          <div className="p-3 rounded-xl bg-amber-500/20 mb-3">
            <Sun className="w-6 h-6 text-amber-400" />
          </div>
          <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">
            Lighting
          </span>
          <span className="text-xl font-black text-white leading-none capitalize text-center leading-tight">
            {venue.lighting ? venue.lighting.replace("_", " ") : "Normal"}
          </span>
        </div>
      </div>

      {activeDistribution && (
        <div className="mb-6">
          <RatingDistribution
            reviews={reviews}
            activeMetric={activeDistribution}
            venueName={venue.name}
            onClose={() => setActiveDistribution(null)}
          />
        </div>
      )}

      {/* Ambient Noise Spectrum Frequency Visualization */}
      <div className="mb-6">
        <AmbientNoiseSpectrumVisualizer
          venueId={venue.id}
          venueName={venue.name}
          noiseLevel={venue.noiseLevel}
        />
      </div>

      {/* Noise Reporting Widget */}
      <div className="mb-6">
        <NoiseReportingWidget venueId={venue.id} venueName={venue.name} />
      </div>

      {/* WiFi & Occupancy Noise Chart */}
      <VenueNoiseChart
        wifiPredictions={wifiPredictions}
        occupancyData={occupancyData}
      />

      {/* 24-Hour Forecast Graphs */}
      {noiseForecast.length > 0 && (
        <>
          <AmbientNoiseTrendGraph venueId={venue.id} forecast={noiseForecast} />
          <NoiseTimelineChart forecast={noiseForecast} />
        </>
      )}

      {/* Audio Equalizer and Intelligence Brief */}
      <div className="space-y-6 mt-6">
        <AudioEqualizer venueName={venue.name} />

        <div className="accent-bg-10 p-5 rounded-2xl border accent-border-30">
          <h3 className="text-xs font-black uppercase tracking-widest accent-text mb-2 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Intelligence Brief
          </h3>
          <p className="text-zinc-200 text-sm leading-relaxed font-medium">
            Analysis based on Multi-Agent telemetry suggests this{" "}
            {venue.category || "workspace"} is optimal for{" "}
            {venue.category === "cafe"
              ? "collaborative sessions"
              : "high-focus work"}
            . Noise floor is {venue.noiseLevel || "ambient"} and connectivity is
            verified as {venue.wifi ? "stable" : "pending"}.
            {venue.hasErgonomic &&
              " The workspace features verified ergonomic chairs and height-adjustable/standing desks."}
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {venue.musicStyle === "lofi" && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold">
                <span>🎵 Lo-Fi/Chill Beats</span>
              </div>
            )}
            {venue.musicStyle === "classical_jazz" && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold">
                <span>🎷 Classical/Jazz Background</span>
              </div>
            )}
            {(venue.musicStyle === "no_music" || venue.hasNoMusic) && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold">
                <span>🔇 No Music Played</span>
              </div>
            )}
            {venue.hasPhoneBooths && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold">
                <span>📞 Soundproof Booths Available</span>
              </div>
            )}
            {venue.outletLocations && venue.outletLocations.length > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 text-zinc-200 border border-white/10 text-xs font-semibold">
                <span>
                  🔌 Outlets:{" "}
                  {venue.outletLocations.map((l) => l.replace("_", " ")).join(", ")}
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
