"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudRain,
  Sun,
  Droplets,
  Wind,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { useCloudRenderer } from "@/hooks/useCloudRenderer";
import {
  fetchLiveVenueWeather,
  WeatherData,
  DEFAULT_MOCK_WEATHER,
} from "@/utils/weatherToCloudDensity";

export interface WeatherCloudRendererProps {
  lat?: number;
  lng?: number;
  initialWeatherData?: Partial<WeatherData> | null;
  className?: string;
  height?: string | number;
  showOverlay?: boolean;
  interactive?: boolean;
  quality?: "low" | "medium" | "high";
}

export function WeatherCloudRenderer({
  lat,
  lng,
  initialWeatherData,
  className = "",
  height = "320px",
  showOverlay = true,
  interactive = true,
  quality = "medium",
}: WeatherCloudRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [weather, setWeather] = useState<WeatherData>(() => ({
    ...DEFAULT_MOCK_WEATHER,
    ...initialWeatherData,
  }));
  const [_loading, setLoading] = useState<boolean>(!initialWeatherData);
  const [isLive, setIsLive] = useState<boolean>(false);

  const { isSupported, fps } = useCloudRenderer(canvasRef, {
    weatherData: weather,
    quality,
    animate: true,
    resolutionScale: 0.75,
  });

  useEffect(() => {
    let isMounted = true;
    async function loadWeather() {
      if (typeof lat === "number" && typeof lng === "number") {
        setLoading(true);
        const liveData = await fetchLiveVenueWeather(lat, lng);
        if (isMounted) {
          setWeather(liveData);
          setIsLive(true);
          setLoading(false);
        }
      }
    }

    if (!initialWeatherData && lat !== undefined && lng !== undefined) {
      loadWeather();
    }
    return () => {
      isMounted = false;
    };
  }, [lat, lng, initialWeatherData]);

  const ConditionIcon =
    weather.weatherCondition === "rainy" ||
    weather.weatherCondition === "stormy"
      ? CloudRain
      : weather.weatherCondition === "clear"
        ? Sun
        : Cloud;

  return (
    <div
      className={`relative w-full rounded-3xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-900 ${className}`}
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      {/* Fallback view if WebGL 2 is unsupported */}
      {!isSupported ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-blue-900 to-indigo-950 text-white">
          <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
          <h4 className="text-lg font-bold">2D Weather Mode</h4>
          <p className="text-xs text-zinc-300 max-w-sm mt-1">
            WebGL 2.0 is unavailable on this device. Displaying standard weather
            metrics.
          </p>
          <div className="mt-4 flex items-center gap-3 bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl text-sm font-semibold">
            <ConditionIcon className="w-5 h-5 text-blue-300" />
            <span>{weather.cloudCover}% Cloud Cover</span>
          </div>
        </div>
      ) : (
        /* WebGL 2 Volumetric Cloud Canvas */
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-pointer transition-opacity duration-500"
        />
      )}

      {/* Live Weather Overlay */}
      {showOverlay && (
        <div className="absolute inset-0 pointer-events-none p-4 sm:p-6 flex flex-col justify-between">
          {/* Header Row */}
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-white text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              <span>3D Volumetric Weather</span>
              {isLive && (
                <span className="flex h-2 w-2 rounded-full bg-green-400 animate-ping" />
              )}
            </div>

            {interactive && (
              <div className="px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md text-[11px] font-mono text-zinc-300 border border-white/5">
                {fps} FPS
              </div>
            )}
          </div>

          {/* Bottom Weather Cards */}
          <div className="flex items-end justify-between gap-4">
            <div className="bg-black/65 backdrop-blur-xl border border-white/10 p-3.5 sm:p-4 rounded-2xl text-white max-w-xs shadow-xl">
              <div className="flex items-center gap-2.5 mb-1.5">
                <ConditionIcon className="w-6 h-6 text-blue-400 shrink-0" />
                <div>
                  <h3 className="text-base font-black capitalize leading-none">
                    {weather.weatherCondition.replace("_", " ")}
                  </h3>
                  <span className="text-[11px] text-zinc-300 font-medium">
                    {weather.temperature}°C &bull;{" "}
                    {weather.isDaytime ? "Day" : "Night"}
                  </span>
                </div>
              </div>

              {/* Weather parameters */}
              <div className="grid grid-cols-3 gap-2 pt-2.5 mt-2 border-t border-white/10 text-[11px] font-semibold text-zinc-300">
                <div className="flex flex-col items-center">
                  <span className="text-zinc-400 text-[9px] uppercase tracking-wider flex items-center gap-1">
                    <Cloud className="w-2.5 h-2.5" /> Clouds
                  </span>
                  <span className="text-white text-xs font-bold">
                    {weather.cloudCover}%
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-zinc-400 text-[9px] uppercase tracking-wider flex items-center gap-1">
                    <Droplets className="w-2.5 h-2.5" /> Humidity
                  </span>
                  <span className="text-white text-xs font-bold">
                    {weather.humidity}%
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-zinc-400 text-[9px] uppercase tracking-wider flex items-center gap-1">
                    <Wind className="w-2.5 h-2.5" /> Wind
                  </span>
                  <span className="text-white text-xs font-bold">
                    {weather.windSpeed} km/h
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
