"use client";

import React from "react";
import { Zap, Volume2 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import type { HourlyForecast } from "@/components/noise/NoiseTimelineChart";

export interface WifiPredictionPoint {
  time: string;
  download: number;
  upload: number;
  latency: number;
  crowd: string;
}

export interface OccupancyDataPoint {
  time: string;
  occupancy: number;
}

export interface VenueNoiseChartProps {
  wifiPredictions?: WifiPredictionPoint[] | null;
  occupancyData?: OccupancyDataPoint[] | null;
  forecast?: HourlyForecast[] | null;
  className?: string;
  testId?: string;
}

export function VenueNoiseChart({
  wifiPredictions = [],
  occupancyData = [],
  forecast = [],
  className = "",
  testId = "venue-noise-chart",
}: VenueNoiseChartProps) {
  const safeWifi = Array.isArray(wifiPredictions) ? wifiPredictions : [];
  const safeOccupancy = Array.isArray(occupancyData) ? occupancyData : [];
  const safeForecast = Array.isArray(forecast) ? forecast : [];

  const hasWifi = safeWifi.length > 0;
  const hasOccupancy = safeOccupancy.length > 0;
  const hasForecast = safeForecast.length > 0;

  if (!hasWifi && !hasOccupancy && !hasForecast) {
    return null;
  }

  const forecastData = safeForecast
    .filter((f) => f && typeof f === "object")
    .map((f) => {
      const hourNum =
        typeof f.hour === "number" && !isNaN(f.hour)
          ? f.hour
          : parseInt(String(f.hour || 0), 10) || 0;
      const formattedHour = `${Math.max(0, Math.min(23, hourNum))
        .toString()
        .padStart(2, "0")}:00`;
      const confidence =
        typeof f.confidence === "number" && !isNaN(f.confidence)
          ? f.confidence
          : 0;

      return {
        hour: formattedHour,
        predictedDb: f.predictedDb,
        confidence,
        rawHour: f.hour,
      };
    });

  return (
    <div data-testid={testId} className={`space-y-6 ${className}`.trim()}>
      {hasWifi && (
        <div
          data-testid="wifi-prediction-section"
          className="bg-black/20 p-5 rounded-2xl border border-white/5 shadow-sm"
        >
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-200 mb-1 flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-400" />
            AI Wifi Prediction
          </h3>
          <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-4">
            Expected speeds based on crowd telemetry
          </p>
          <div className="h-40 w-full mt-2">
            <ResponsiveContainer width="99%" height="100%" debounce={50}>
              <BarChart data={safeWifi}>
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#888" }}
                />
                <YAxis
                  tickFormatter={(value) => `${value} Mbps`}
                  tick={{ fontSize: 10, fill: "#888" }}
                  width={40}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      if (!data) return null;
                      return (
                        <div
                          data-testid="wifi-tooltip"
                          className="bg-zinc-900 border border-zinc-700 p-2.5 rounded shadow-xl"
                        >
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                            {data.time}
                          </p>
                          <p className="text-sm font-bold text-blue-400">
                            {data.download ?? 0} Mbps (Download)
                          </p>
                          <p className="text-sm font-bold text-green-400">
                            {data.upload ?? 0} Mbps (Upload)
                          </p>
                          <p className="text-sm font-bold text-orange-400">
                            {data.latency ?? 0} ms (Latency)
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">
                            Crowd: {data.crowd || "N/A"}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  dataKey="download"
                  fill="#60a5fa"
                  radius={[4, 4, 0, 0]}
                  name="Download"
                />
                <Bar
                  dataKey="upload"
                  fill="#4ade80"
                  radius={[4, 4, 0, 0]}
                  name="Upload"
                />
                <Bar
                  dataKey="latency"
                  fill="#fb923c"
                  radius={[4, 4, 0, 0]}
                  name="Latency"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasOccupancy && (
        <div
          data-testid="occupancy-section"
          className="bg-black/20 p-5 rounded-2xl border border-white/5 shadow-sm"
        >
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-200 mb-1 flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-400" />
            Live Crowd Occupancy
          </h3>
          <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-4">
            Historical crowd levels by hour
          </p>
          <div className="h-40 w-full mt-2">
            <ResponsiveContainer width="99%" height="100%" debounce={50}>
              <LineChart data={safeOccupancy}>
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#888" }}
                />
                <YAxis
                  tickFormatter={(value) => `${value}%`}
                  tick={{ fontSize: 10, fill: "#888" }}
                  width={40}
                  domain={[0, 100]}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{
                    stroke: "rgba(255,255,255,0.1)",
                    strokeWidth: 2,
                  }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      if (!data) return null;
                      return (
                        <div
                          data-testid="occupancy-tooltip"
                          className="bg-zinc-900 border border-zinc-700 p-2.5 rounded shadow-xl"
                        >
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                            {data.time}
                          </p>
                          <p className="text-sm font-bold text-orange-400">
                            {data.occupancy ?? 0}% Occupied
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="occupancy"
                  stroke="#fb923c"
                  strokeWidth={3}
                  dot={{ fill: "#fb923c", r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasForecast && (
        <div
          data-testid="noise-timeline-section"
          className="bg-black/20 p-5 rounded-2xl border border-white/5 shadow-sm"
        >
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-200 mb-1 flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-pink-400" />
            Noise Level Timeline
          </h3>
          <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-4">
            Predicted ambient noise (dB) throughout the day
          </p>
          <div className="h-44 w-full mt-2">
            <ResponsiveContainer width="99%" height="100%" debounce={50}>
              <LineChart data={forecastData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="hour"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#71717a" }}
                />
                <YAxis
                  domain={[30, 90]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  tickFormatter={(val) => `${val}dB`}
                  width={35}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      if (!data) return null;
                      const confPercent = Math.round((data.confidence ?? 0) * 100);
                      return (
                        <div
                          data-testid="noise-tooltip"
                          className="bg-zinc-900 border border-zinc-700 p-2.5 rounded shadow-xl text-xs"
                        >
                          <p className="font-bold text-zinc-200 mb-1">{data.hour}</p>
                          <p className="text-pink-400 font-semibold">
                            {data.predictedDb ? `${data.predictedDb} dB` : "No data"}
                          </p>
                          <p className="text-zinc-500 text-[10px] mt-0.5">
                            Confidence: {isNaN(confPercent) ? 0 : confPercent}%
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="predictedDb"
                  stroke="#f472b6"
                  strokeWidth={2}
                  dot={{ fill: "#f472b6", r: 3 }}
                  activeDot={{ r: 5, fill: "#f472b6" }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export default VenueNoiseChart;
