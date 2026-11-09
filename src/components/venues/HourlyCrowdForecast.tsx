"use client";

import React, { useState, useMemo } from "react";
import { Users, Volume2, Armchair, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HourlyForecastItem {
  hour: number;
  crowdPercentage: number;
  noiseLevel: "quiet" | "moderate" | "loud";
  decibels?: number;
  availableSeats?: number;
}

export interface HourlyCrowdForecastProps {
  venueId?: string;
  venueName?: string;
  forecast?: HourlyForecastItem[];
  totalSeats?: number;
  className?: string;
  "data-testid"?: string;
  onHourChange?: (hour: number) => void;
}

// Generate realistic deterministic 24-hour curve if none provided
function generateDefaultForecast(totalSeats = 40): HourlyForecastItem[] {
  return Array.from({ length: 24 }, (_, hour) => {
    let crowd: number;
    let noise: "quiet" | "moderate" | "loud";
    let db: number;

    if (hour >= 0 && hour < 7) {
      crowd = 5 + Math.round(Math.sin(hour) * 3);
      noise = "quiet";
      db = 32;
    } else if (hour >= 7 && hour < 11) {
      crowd = 25 + (hour - 7) * 12;
      noise = crowd > 50 ? "moderate" : "quiet";
      db = 42 + Math.round(crowd * 0.2);
    } else if (hour >= 11 && hour < 14) {
      crowd = 75 + Math.round(Math.sin(hour) * 15);
      noise = crowd > 80 ? "loud" : "moderate";
      db = 62 + Math.round(crowd * 0.15);
    } else if (hour >= 14 && hour < 17) {
      crowd = 50 + Math.round(Math.cos(hour) * 10);
      noise = "moderate";
      db = 52;
    } else if (hour >= 17 && hour < 21) {
      crowd = 85 + Math.round(Math.sin(hour) * 10);
      noise = "loud";
      db = 68;
    } else {
      crowd = 30 - (hour - 21) * 8;
      noise = "quiet";
      db = 38;
    }

    const clampedCrowd = Math.max(0, Math.min(100, crowd));
    const available = Math.max(
      0,
      Math.round(totalSeats * (1 - clampedCrowd / 100))
    );

    return {
      hour,
      crowdPercentage: clampedCrowd,
      noiseLevel: noise,
      decibels: db,
      availableSeats: available,
    };
  });
}

/**
 * Returns gradient color class based on crowd density:
 * Blue (Quiet: <40%), Purple (Moderate: 40-75%), Pink (Packed: >75%)
 */
export function getCrowdGradient(crowd: number): {
  barClass: string;
  label: string;
  badgeClass: string;
} {
  if (crowd < 40) {
    return {
      barClass: "bg-gradient-to-t from-blue-600 to-cyan-400",
      label: "Quiet",
      badgeClass: "bg-blue-500/20 text-cyan-300 border-blue-500/30",
    };
  }
  if (crowd <= 75) {
    return {
      barClass: "bg-gradient-to-t from-purple-600 to-indigo-400",
      label: "Moderate",
      badgeClass: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    };
  }
  return {
    barClass: "bg-gradient-to-t from-pink-600 to-rose-400",
    label: "Packed",
    badgeClass: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  };
}

export function HourlyCrowdForecast({
  venueId,
  venueName,
  forecast,
  totalSeats = 45,
  className,
  "data-testid": dataTestId = "hourly-crowd-forecast",
  onHourChange,
}: HourlyCrowdForecastProps) {
  const currentHour = useMemo(() => new Date().getHours(), []);
  const [selectedHour, setSelectedHour] = useState<number>(currentHour);

  const forecastData = useMemo(() => {
    if (forecast && forecast.length === 24) {
      return forecast;
    }
    return generateDefaultForecast(totalSeats);
  }, [forecast, totalSeats]);

  const activeReading = useMemo(() => {
    return (
      forecastData.find((f) => f.hour === selectedHour) || forecastData[selectedHour] ||
      forecastData[0]
    );
  }, [forecastData, selectedHour]);

  const isCurrentLiveHour = selectedHour === currentHour;
  const gradientInfo = getCrowdGradient(activeReading.crowdPercentage);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSelectedHour(val);
    onHourChange?.(val);
  };

  const handleBarClick = (hour: number) => {
    setSelectedHour(hour);
    onHourChange?.(hour);
  };

  const formatHour = (h: number) => {
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:00 ${period}`;
  };

  return (
    <div
      data-testid={dataTestId}
      className={cn(
        "bg-zinc-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur-md shadow-xl text-white",
        className
      )}
    >
      {/* Header & Live Status */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold tracking-wide">
            24-Hour Crowd & Noise Forecast
          </h3>
        </div>

        {isCurrentLiveHour ? (
          <div
            data-testid="live-indicator-badge"
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            LIVE
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSelectedHour(currentHour);
              onHourChange?.(currentHour);
            }}
            className="text-xs text-zinc-400 hover:text-white transition-colors underline underline-offset-2"
          >
            Jump to current hour
          </button>
        )}
      </div>

      {/* Selected Hour Dashboard Cards */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col items-center text-center">
          <div className="text-[11px] text-zinc-400 font-medium mb-1">Time</div>
          <div
            data-testid="selected-hour-label"
            className="text-sm font-bold text-white tracking-tight"
          >
            {formatHour(selectedHour)}
          </div>
        </div>

        <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col items-center text-center">
          <div className="text-[11px] text-zinc-400 font-medium mb-1 flex items-center gap-1">
            <Users className="w-3 h-3 text-purple-400" /> Crowd
          </div>
          <div className="flex items-center gap-1.5">
            <span
              data-testid="crowd-percentage-value"
              className="text-sm font-extrabold text-white"
            >
              {activeReading.crowdPercentage}%
            </span>
            <span
              data-testid="crowd-density-badge"
              className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded border",
                gradientInfo.badgeClass
              )}
            >
              {gradientInfo.label}
            </span>
          </div>
        </div>

        <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col items-center text-center">
          <div className="text-[11px] text-zinc-400 font-medium mb-1 flex items-center gap-1">
            <Armchair className="w-3 h-3 text-cyan-400" /> Seats
          </div>
          <div
            data-testid="seats-available-value"
            className="text-sm font-extrabold text-white"
          >
            {activeReading.availableSeats ??
              Math.max(
                0,
                Math.round(totalSeats * (1 - activeReading.crowdPercentage / 100))
              )}{" "}
            left
          </div>
        </div>
      </div>

      {/* Vertical Bars Histogram */}
      <div
        data-testid="hourly-bars-container"
        className="relative h-28 flex items-end gap-1 px-1 mb-3 pt-4 border-b border-white/10"
      >
        {forecastData.map((item) => {
          const isSelected = item.hour === selectedHour;
          const isCurrent = item.hour === currentHour;
          const barHeight = Math.max(12, item.crowdPercentage);
          const barStyle = getCrowdGradient(item.crowdPercentage);

          return (
            <div
              key={item.hour}
              onClick={() => handleBarClick(item.hour)}
              className="flex-1 flex flex-col items-center justify-end h-full cursor-pointer group relative"
              title={`${formatHour(item.hour)}: ${item.crowdPercentage}% crowd`}
            >
              {/* Bar element with fluid gradient */}
              <div
                style={{ height: `${barHeight}%` }}
                className={cn(
                  "w-full rounded-t-sm transition-all duration-150",
                  barStyle.barClass,
                  isSelected
                    ? "brightness-125 ring-2 ring-white scale-y-105 z-10"
                    : "opacity-75 group-hover:opacity-100 group-hover:brightness-110",
                  isCurrent && !isSelected && "ring-1 ring-emerald-400/80"
                )}
              />

              {/* Current Hour dot indicator */}
              {isCurrent && (
                <div
                  aria-label="current-hour-dot"
                  className="absolute -top-1 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Axis Hour Labels (Every 3 hours) */}
      <div className="flex justify-between text-[10px] text-zinc-500 font-mono px-1 mb-4 select-none">
        <span>12AM</span>
        <span>3AM</span>
        <span>6AM</span>
        <span>9AM</span>
        <span>12PM</span>
        <span>3PM</span>
        <span>6PM</span>
        <span>9PM</span>
        <span>11PM</span>
      </div>

      {/* Interactive 24-Hour Timeline Scrub Slider */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs text-zinc-400">
          <label htmlFor="crowd-timeline-slider" className="font-medium">
            Scrub Timeline (00:00 - 23:00)
          </label>
          <span className="text-zinc-500 font-mono text-[11px]">
            {selectedHour.toString().padStart(2, "0")}:00
          </span>
        </div>
        <input
          id="crowd-timeline-slider"
          data-testid="crowd-timeline-slider"
          type="range"
          min="0"
          max="23"
          step="1"
          value={selectedHour}
          onChange={handleSliderChange}
          className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          aria-label="24-hour crowd forecast timeline slider"
        />
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-white/5 text-[11px] text-zinc-400">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
          <span>Quiet (&lt;40%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
          <span>Moderate (40-75%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-pink-500" />
          <span>Packed (&gt;75%)</span>
        </div>
      </div>
    </div>
  );
}

export default HourlyCrowdForecast;

