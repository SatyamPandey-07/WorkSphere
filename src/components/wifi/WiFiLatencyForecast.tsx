"use client";

import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";
import { Wifi, Clock, TrendingUp, AlertTriangle } from "lucide-react";
import { useWiFiLatency } from "@/hooks/useWiFiLatency";

interface WiFiLatencyForecastProps {
  venueId: string;
  venueName: string;
  historicalLatency?: number[];
  historicalPacketLoss?: number[];
  weatherScore?: number;
  eventImpact?: number;
  currentLoad?: number;
}

function formatHour(hour: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "a" : "p";
  return `${h}${ampm}`;
}

function getLatencyQuality(latency: number): {
  label: string;
  color: string;
} {
  if (latency < 25) return { label: "Excellent", color: "text-emerald-500" };
  if (latency < 50) return { label: "Good", color: "text-amber-500" };
  return { label: "Poor", color: "text-rose-500" };
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-zinc-900/95 dark:bg-black/95 backdrop-blur-xl border border-zinc-700 rounded-xl p-3 shadow-2xl">
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">
        {label ? formatHour(parseInt(label)) : "Now"}
      </p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: entry.name === "latency" ? "#3b82f6" : "#f59e0b",
            }}
          />
          <span className="text-zinc-400 capitalize">{entry.name}:</span>
          <span className="font-bold text-white">
            {entry.value.toFixed(1)}
            {entry.name === "latency" ? "ms" : "%"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function WiFiLatencyForecast({
  venueId,
  venueName,
  historicalLatency,
  historicalPacketLoss,
  weatherScore,
  eventImpact,
  currentLoad,
}: WiFiLatencyForecastProps) {
  const { predictions, isLoading, predict } = useWiFiLatency({
    venueId,
    historicalLatency,
    historicalPacketLoss,
    weatherScore,
    eventImpact,
    currentLoad,
  });

  if (isLoading && !predictions) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-xs font-bold text-zinc-500">
            Loading WiFi predictions...
          </span>
        </div>
      </div>
    );
  }

  if (!predictions) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
        <p className="text-xs text-zinc-400">No prediction data available</p>
      </div>
    );
  }

  const chartData = predictions.hourlyLatency.map((latency, i) => ({
    hour: i.toString(),
    latency,
    packetLoss: predictions.hourlyPacketLoss[i],
  }));

  const currentHour = new Date().getHours();
  const currentLatency = predictions.hourlyLatency[currentHour] ?? 0;
  const quality = getLatencyQuality(currentLatency);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-150 dark:border-zinc-850">
        <div>
          <p className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-50 uppercase flex items-center gap-1.5">
            <Wifi className="w-4 h-4 text-blue-500" />
            WiFi Latency Forecast
          </p>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            24-hour prediction for {venueName}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-black ${quality.color}`}>
            {quality.label}
          </span>
          <span className="text-[10px] text-zinc-400">
            ({currentLatency.toFixed(0)}ms)
          </span>
        </div>
      </div>

      {/* Latency line graph */}
      <div className="mt-4 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(113,113,122,0.15)"
            />
            <XAxis
              dataKey="hour"
              tickFormatter={formatHour}
              tick={{ fontSize: 9, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
              interval={3}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}ms`}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="latency"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#latencyGradient)"
              dot={false}
              activeDot={{ r: 4, fill: "#3b82f6" }}
            />
            <ReferenceLine
              x={currentHour.toString()}
              stroke="#f43f5e"
              strokeDasharray="4 4"
              label={{
                value: "Now",
                position: "top",
                fill: "#f43f5e",
                fontSize: 9,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
            Best Time
          </p>
          <p className="text-sm font-black text-emerald-500 mt-0.5">
            {formatHour(predictions.bestTimeSlot.hour)}
          </p>
          <p className="text-[10px] text-zinc-400">
            {predictions.bestTimeSlot.latency.toFixed(0)}ms
          </p>
        </div>
        <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
            Peak Hours
          </p>
          <p className="text-sm font-black text-amber-500 mt-0.5">
            {predictions.peakHours.length}
          </p>
          <p className="text-[10px] text-zinc-400">
            {predictions.peakHours.length > 0
              ? `${formatHour(predictions.peakHours[0])}-${formatHour(predictions.peakHours[predictions.peakHours.length - 1])}`
              : "None"}
          </p>
        </div>
        <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
            Confidence
          </p>
          <p className="text-sm font-black text-blue-500 mt-0.5">
            {(predictions.confidence * 100).toFixed(0)}%
          </p>
          <p className="text-[10px] text-zinc-400">ML model</p>
        </div>
      </div>

      {/* Peak hours warning */}
      {predictions.peakHours.includes(currentHour) && (
        <div className="mt-3 p-2 rounded-lg border border-amber-500/20 bg-amber-500/10 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
            Peak congestion hours. Best to avoid bandwidth-heavy tasks.
          </span>
        </div>
      )}

      {/* Best time recommendation */}
      {predictions.bestTimeSlot.hour === currentHour && (
        <div className="mt-3 p-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            Great time for bandwidth-heavy work! WiFi is at its best right now.
          </span>
        </div>
      )}

      <button
        onClick={predict}
        className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <TrendingUp className="w-3.5 h-3.5" />
        Refresh Prediction
      </button>
    </div>
  );
}
