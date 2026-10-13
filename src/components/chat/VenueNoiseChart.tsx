"use client";

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
  wifiPredictions?: WifiPredictionPoint[];
  occupancyData?: OccupancyDataPoint[];
  forecast?: HourlyForecast[];
}

export function VenueNoiseChart({
  wifiPredictions = [],
  occupancyData = [],
  forecast = [],
}: VenueNoiseChartProps) {
  const hasWifi = wifiPredictions.length > 0;
  const hasOccupancy = occupancyData.length > 0;
  const hasForecast = forecast.length > 0;

  if (!hasWifi && !hasOccupancy && !hasForecast) {
    return null;
  }

  const forecastData = forecast.map((f) => ({
    hour: `${f.hour.toString().padStart(2, "0")}:00`,
    predictedDb: f.predictedDb,
    confidence: f.confidence,
    rawHour: f.hour,
  }));

  return (
    <>
      {hasWifi && (
        <div className="mb-6 bg-black/20 p-5 rounded-2xl border border-white/5 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-200 mb-1 flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-400" />
            AI Wifi Prediction
          </h3>
          <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-4">
            Expected speeds based on crowd telemetry
          </p>
          <div className="h-40 w-full mt-2">
            <ResponsiveContainer width="99%" height="100%" debounce={50}>
              <BarChart data={wifiPredictions}>
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
                      return (
                        <div className="bg-zinc-900 border border-zinc-700 p-2.5 rounded shadow-xl">
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                            {data.time}
                          </p>
                          <p className="text-sm font-bold text-blue-400">
                            {data.download} Mbps (Download)
                          </p>
                          <p className="text-sm font-bold text-green-400">
                            {data.upload} Mbps (Upload)
                          </p>
                          <p className="text-sm font-bold text-orange-400">
                            {data.latency} ms (Latency)
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">
                            Crowd: {data.crowd}
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
        <div className="mb-6 bg-black/20 p-5 rounded-2xl border border-white/5 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-200 mb-1 flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-400" />
            Live Crowd Occupancy
          </h3>
          <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-4">
            Historical crowd levels by hour
          </p>
          <div className="h-40 w-full mt-2">
            <ResponsiveContainer width="99%" height="100%" debounce={50}>
              <LineChart data={occupancyData}>
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
                      return (
                        <div className="bg-zinc-900 border border-zinc-700 p-2.5 rounded shadow-xl">
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                            {data.time}
                          </p>
                          <p className="text-sm font-bold text-orange-400">
                            {data.occupancy}% Occupied
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
        <div className="mb-6 bg-black/20 p-5 rounded-2xl border border-white/5 shadow-sm">
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
                      return (
                        <div className="bg-zinc-900 border border-zinc-700 p-2.5 rounded shadow-xl text-xs">
                          <p className="font-bold text-zinc-200 mb-1">{data.hour}</p>
                          <p className="text-pink-400 font-semibold">
                            {data.predictedDb ? `${data.predictedDb} dB` : "No data"}
                          </p>
                          <p className="text-zinc-500 text-[10px] mt-0.5">
                            Confidence: {Math.round(data.confidence * 100)}%
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
    </>
  );
}

export default VenueNoiseChart;
