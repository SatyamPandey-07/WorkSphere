"use client";

import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface HourlyForecast {
  hour: number;
  predictedDb: number | null;
  confidence: number;
  samples: number;
}

export interface NoiseTimelineChartProps {
  forecast?: HourlyForecast[];
  className?: string;
  "data-testid"?: string;
}

export function NoiseTimelineChart({
  forecast = [],
  className,
  "data-testid": dataTestId = "noise-timeline-chart",
}: NoiseTimelineChartProps) {
  if (!forecast || forecast.length === 0) {
    return (
      <div
        data-testid={dataTestId}
        className={cn(
          "mb-6 bg-black/20 p-5 rounded-2xl border border-white/5 shadow-sm text-center",
          className
        )}
      >
        <h3 className="text-xs font-black uppercase tracking-widest text-zinc-200 mb-1 flex items-center justify-center gap-2">
          <Volume2 className="w-4 h-4 text-pink-400" />
          Noise Level Timeline
        </h3>
        <p data-testid="noise-timeline-empty" className="text-xs text-zinc-400 py-4">
          No noise level forecast data available for this venue.
        </p>
      </div>
    );
  }

  // Format data for Recharts
  const chartData = forecast.map((f) => ({
    hour: `${f.hour.toString().padStart(2, "0")}:00`,
    predictedDb: f.predictedDb,
    confidence: f.confidence,
    samples: f.samples,
    rawHour: f.hour,
  }));

  return (
    <div
      data-testid={dataTestId}
      className={cn(
        "mb-6 bg-black/20 p-5 rounded-2xl border border-white/5 shadow-sm",
        className
      )}
    >
      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-200 mb-1 flex items-center gap-2">
        <Volume2 className="w-4 h-4 text-pink-400" />
        Noise Level Timeline
      </h3>
      <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-4">
        24-hour historical and forecasted ambient decibels
      </p>

      <div data-testid="noise-timeline-container" className="h-40 w-full mt-2">
        <ResponsiveContainer width="99%" height="100%" debounce={50}>
          <LineChart data={chartData}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="rgba(255, 255, 255, 0.05)"
            />
            <XAxis
              dataKey="hour"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#888" }}
              interval={3}
            />
            <YAxis
              tickFormatter={(value) => `${value} dB`}
              tick={{ fontSize: 10, fill: "#888" }}
              width={45}
              domain={[30, 90]}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{
                stroke: "rgba(255, 255, 255, 0.1)",
                strokeWidth: 2,
              }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  if (data.predictedDb === null) return null;
                  return (
                    <div className="bg-zinc-900 border border-zinc-700 p-2.5 rounded shadow-xl">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                        {data.hour}
                      </p>
                      <p className="text-sm font-bold text-pink-400">
                        {data.predictedDb} dB
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        Confidence: {Math.round(data.confidence * 100)}% (
                        {data.samples} sample{data.samples === 1 ? "" : "s"})
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
              stroke="#f43f5e"
              strokeWidth={3}
              dot={{ fill: "#f43f5e", r: 4 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default NoiseTimelineChart;
