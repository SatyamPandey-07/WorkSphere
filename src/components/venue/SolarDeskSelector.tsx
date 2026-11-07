"use client";

import React, { useState, useEffect } from "react";
import {
  Sun,
  Sunrise,
  Sunset,
  Compass,
  AlertTriangle,
  Sparkles,
  Eye,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Layers,
  Info,
  Calendar,
} from "lucide-react";
import type { DeskSolarExposure, SolarCoordinates } from "@/lib/geo/solarPosition";
import { cn } from "@/lib/utils";

export interface SolarDeskSelectorProps {
  venueId?: string;
  venueName?: string;
  onSelectDesk?: (deskId: string) => void;
  className?: string;
  "data-testid"?: string;
}

export function SolarDeskSelector({
  venueId = "venue-sf-01",
  venueName = "Mission Focus Coworking & Cafe",
  onSelectDesk,
  className = "",
  ...props
}: SolarDeskSelectorProps) {
  const [selectedHour, setSelectedHour] = useState<number>(14); // 2:00 PM
  const [solarData, setSolarData] = useState<{
    solarCoordinates: SolarCoordinates;
    hourlyTimeline: Array<{ hour: number; timeLabel: string; elevationDeg: number; azimuthDeg: number }>;
    deskExposures: DeskSolarExposure[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);

  const fetchSolarExposure = async (hour: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/venues/${venueId}/solar?hour=${hour}`);
      const data = await res.json();
      if (data.success) {
        setSolarData(data);
        if (!selectedDeskId && data.deskExposures.length > 0) {
          setSelectedDeskId(data.deskExposures[0].seatId);
        }
      }
    } catch (err) {
      console.error("Failed to load solar data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSolarExposure(selectedHour);
  }, [selectedHour, venueId]);

  const getProfileBadge = (profile: DeskSolarExposure["profile"]) => {
    switch (profile) {
      case "DIRECT_SUN_GLARE":
        return {
          label: "☀️ Direct Screen Glare",
          color: "bg-amber-500/20 border-amber-500/40 text-amber-300",
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
        };
      case "GOLDEN_HOUR_WARMTH":
        return {
          label: "🌅 Golden Hour Glow",
          color: "bg-orange-500/20 border-orange-500/40 text-orange-300",
          icon: <Sunrise className="w-3.5 h-3.5 text-orange-400" />,
        };
      case "DIFFUSE_NATURAL_LIGHT":
        return {
          label: "✨ Soft Natural Daylight",
          color: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
          icon: <Sparkles className="w-3.5 h-3.5 text-emerald-400" />,
        };
      case "DEEP_SHADE":
      default:
        return {
          label: "🌿 Balanced Diffuse Shade",
          color: "bg-blue-500/20 border-blue-500/40 text-blue-300",
          icon: <Eye className="w-3.5 h-3.5 text-blue-400" />,
        };
    }
  };

  return (
    <div
      data-testid={props["data-testid"] || "solar-desk-selector"}
      className={cn("w-full max-w-5xl mx-auto space-y-6", className)}
    >
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-amber-950/40 to-slate-900 border border-amber-500/20 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold uppercase tracking-wider">
              <Sun className="w-3.5 h-3.5" /> Solar Orientation & Glare Visualizer
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Natural Light & Sun Angle Desk Selector
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              Astronomical solar azimuth and altitude ray-tracing. Pick the ideal desk for natural sunlight without screen glare during your video calls and deep focus sessions.
            </p>
          </div>

          {solarData?.solarCoordinates && (
            <div className="flex items-center gap-3 bg-slate-900/80 border border-slate-800 p-4 rounded-2xl shrink-0 font-mono text-xs text-slate-300">
              <Compass className="w-5 h-5 text-amber-400" />
              <div>
                <span className="text-slate-500 block text-[10px]">Sun Position</span>
                <strong>{solarData.solarCoordinates.azimuthDeg}° Bearing</strong>
                <span className="text-slate-400 block text-[11px]">
                  Elevation: {solarData.solarCoordinates.elevationDeg}°
                </span>
                <span className="text-amber-400 block text-[11px]" data-testid="daylight-duration">
                  {Math.max(0.0, solarData.solarCoordinates.daylightDurationHours ?? 0).toFixed(1)} hrs of daylight
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Time of Day Interactive Slider */}
        <div className="mt-6 pt-6 border-t border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400" /> Simulated Time of Day:{" "}
              <strong className="text-white text-sm font-mono">{selectedHour}:00</strong>
            </span>
            <span className="text-slate-400 text-[11px]">Drag slider to simulate sun movement</span>
          </div>

          <input
            type="range"
            data-testid="solar-time-slider"
            aria-label="Simulated Time of Day"
            min={8}
            max={20}
            step={1}
            value={selectedHour}
            onChange={(e) => setSelectedHour(Number(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />

          <div className="flex justify-between text-[11px] text-slate-500 font-mono">
            <span>08:00 (Morning)</span>
            <span>12:00 (Solar Noon)</span>
            <span>16:00 (Afternoon)</span>
            <span>20:00 (Dusk)</span>
          </div>

          {/* Live Sun Path Progress Bar Indicator */}
          {(() => {
            const sunriseHour = 6;
            const sunsetHour = 20;
            const daylightPct = Math.max(
              0,
              Math.min(100, Math.round(((selectedHour - sunriseHour) / (sunsetHour - sunriseHour)) * 100))
            );

            return (
              <div
                className="pt-2 p-3.5 rounded-2xl bg-slate-950/70 border border-amber-500/20 space-y-2.5 backdrop-blur-sm"
                data-testid="sun-path-progress-bar"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-amber-200">
                    <Sun className="w-3.5 h-3.5 text-amber-400 animate-spin-slow" /> Sun Path Progress
                  </span>
                  <span
                    className="font-mono text-[11px] font-bold text-amber-400"
                    data-testid="daylight-percentage"
                  >
                    {daylightPct}% Daylight Completed
                  </span>
                </div>

                {/* Progress Track & Animated Sun Icon */}
                <div className="relative w-full h-3 bg-slate-800 rounded-full overflow-visible flex items-center">
                  {/* Daylight completed fill */}
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 via-orange-400 to-amber-300 rounded-full transition-all duration-300 ease-out shadow-sm shadow-amber-500/50"
                    style={{ width: `${daylightPct}%` }}
                    data-testid="sun-progress-fill"
                  />

                  {/* Accurately positioned sun icon on the arc / progress bar */}
                  <div
                    className="absolute -top-1 -translate-x-1/2 flex items-center justify-center transition-all duration-300 ease-out pointer-events-none"
                    style={{ left: `${daylightPct}%` }}
                    data-testid="sun-progress-icon"
                  >
                    <div className="relative">
                      <span className="absolute -inset-1 rounded-full bg-amber-400/30 blur-sm animate-pulse" />
                      <Sun className="relative w-5 h-5 text-amber-300 fill-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                    </div>
                  </div>
                </div>

                {/* Milestones: Sunrise, Solar Noon, Sunset */}
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                  <span className="flex items-center gap-1 text-orange-300">
                    <Sunrise className="w-3 h-3" /> Sunrise (06:00)
                  </span>
                  <span className="flex items-center gap-1 text-amber-300">
                    <Sun className="w-3 h-3" /> Solar Noon (13:00)
                  </span>
                  <span className="flex items-center gap-1 text-rose-300">
                    <Sunset className="w-3 h-3" /> Sunset (20:00)
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Main Grid: Floorplan Visualizer & Desk Sunlight Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive Floorplan Mockup (7 cols) */}
        <div className="lg:col-span-7 rounded-3xl bg-slate-900/80 border border-slate-800 p-6 space-y-4 backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" /> Venue Floorplan & Sunlight Beams
            </h2>
            <span className="text-[11px] text-slate-400">South & West Windows</span>
          </div>

          {/* Canvas Simulation Mock */}
          <div className="relative w-full h-[320px] rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center p-4">
            {/* Window Glass Walls */}
            <div className="absolute bottom-2 left-8 right-8 h-2 bg-sky-400/40 border-t border-sky-300 rounded" />
            <div className="absolute right-2 top-8 bottom-8 w-2 bg-sky-400/40 border-l border-sky-300 rounded" />
            <span className="absolute bottom-3 text-[10px] text-sky-300 font-mono">South Window Wall</span>
            <span className="absolute right-3 top-1/2 -rotate-90 text-[10px] text-sky-300 font-mono">West Windows</span>

            {/* Sunlight Angle Ray Cone */}
            {solarData?.solarCoordinates && solarData.solarCoordinates.elevationDeg > 0 && (
              <div
                className="absolute inset-0 bg-gradient-to-tr from-amber-500/10 via-amber-400/5 to-transparent pointer-events-none transition-all duration-300"
                style={{
                  opacity: Math.max(0.1, solarData.solarCoordinates.elevationDeg / 60),
                }}
              />
            )}

            {/* Desks Grid */}
            <div className="grid grid-cols-2 gap-6 z-10 w-full max-w-md">
              {solarData?.deskExposures.map((desk) => {
                const isSelected = selectedDeskId === desk.seatId;
                const badge = getProfileBadge(desk.profile);

                return (
                  <button
                    key={desk.seatId}
                    data-testid="solar-desk-card"
                    onClick={() => {
                      setSelectedDeskId(desk.seatId);
                      onSelectDesk?.(desk.seatId);
                    }}
                    className={`p-4 rounded-2xl border text-left transition-all duration-200 ${
                      isSelected
                        ? "bg-amber-500/20 border-amber-400 shadow-lg shadow-amber-950/30 scale-[1.02]"
                        : "bg-slate-900/90 border-slate-700 hover:border-slate-500"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-white text-xs">{desk.seatNumber}</span>
                      {badge.icon}
                    </div>
                    <span className="text-[10px] font-mono block text-slate-400">{desk.lightIntensityLux} Lux</span>
                    <span className="text-[10px] text-slate-300 line-clamp-1">{badge.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Selected Desk Glare & Sunlight Inspector (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {solarData?.deskExposures.map((desk) => {
            if (desk.seatId !== selectedDeskId) return null;
            const badge = getProfileBadge(desk.profile);

            return (
              <div
                key={desk.seatId}
                className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-5 backdrop-blur-md shadow-lg"
              >
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                    Desk Lighting Analysis
                  </span>
                  <h3 className="text-lg font-bold text-white">{desk.seatNumber}</h3>
                </div>

                {/* Status Badge */}
                <div className={`p-3.5 rounded-2xl border ${badge.color} space-y-1.5`}>
                  <div className="flex items-center gap-2 font-bold text-xs">
                    {badge.icon}
                    <span>{badge.label}</span>
                  </div>
                  <p className="text-xs leading-relaxed opacity-90">{desk.recommendation}</p>
                </div>

                {/* Metrics Breakdown */}
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-2 border-b border-slate-800">
                    <span className="text-slate-400">Glare Severity Rating</span>
                    <strong
                      className={`font-mono ${
                        desk.glareSeverityPct > 50
                          ? "text-rose-400"
                          : desk.glareSeverityPct > 20
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {desk.glareSeverityPct}% Glare Index
                    </strong>
                  </div>

                  <div className="flex justify-between py-2 border-b border-slate-800">
                    <span className="text-slate-400">Natural Light Intensity</span>
                    <strong className="text-slate-200 font-mono">{desk.lightIntensityLux} Lux</strong>
                  </div>

                  {desk.peakGlareWindow && (
                    <div className="flex justify-between py-2 border-b border-slate-800">
                      <span className="text-slate-400">Peak Glare Window</span>
                      <strong className="text-amber-300 font-mono">{desk.peakGlareWindow}</strong>
                    </div>
                  )}
                </div>

                {/* Reservation Action */}
                <div className="pt-2">
                  <a
                    href={`/reserve?venueId=${venueId}&seat=${desk.seatNumber}`}
                    className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold shadow-lg shadow-amber-600/20 flex items-center justify-center gap-2 transition"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Reserve This Well-Lit Desk
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SolarDeskSelector;
