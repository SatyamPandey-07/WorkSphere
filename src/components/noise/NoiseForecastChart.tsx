"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { QuietHoursBadge } from "./QuietHoursBadge";
import { ForecastLegend } from "./ForecastLegend";
import { Loader2 } from "lucide-react";
import type { NoiseForecastResult } from "@/lib/noiseForecast";

interface NoiseForecastChartProps {
  venueId: string;
}

export function NoiseForecastChart({ venueId }: NoiseForecastChartProps) {
  const [data, setData] = useState<NoiseForecastResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchForecast() {
      try {
        const res = await fetch(
          `/api/venues/${venueId}/noise-metrics/forecast`,
        );
        if (!res.ok) throw new Error("Failed to load forecast");
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading forecast");
      } finally {
        setIsLoading(false);
      }
    }

    fetchForecast();
  }, [venueId]);

  if (isLoading) {
    return (
      <div className="w-full h-64 flex items-center justify-center bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full p-6 text-center bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800">
        <p className="text-sm text-zinc-500">Forecast unavailable.</p>
      </div>
    );
  }

  // Filter out the nulls or handle them. Recharts handles nulls automatically if connectNulls is false.
  // We'll format the data for recharts
  const chartData = data.forecast.map((f) => ({
    hour: `${f.hour.toString().padStart(2, "0")}:00`,
    predictedDb: f.predictedDb,
    confidence: f.confidence,
    rawHour: f.hour,
  }));

  const hasData = chartData.some((d) => d.predictedDb !== null);

  if (!hasData) {
    return (
      <div className="w-full p-6 text-center bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800">
        <p className="text-sm text-zinc-500">
          No historical data to generate forecast.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <QuietHoursBadge hours={data.recommendedHours} />

      <div className="w-full h-64 bg-white dark:bg-zinc-900 rounded-2xl p-4 border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorDb" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#e4e4e7"
              className="dark:stroke-zinc-800"
            />
            <XAxis
              dataKey="hour"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#71717a" }}
              interval={3}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#71717a" }}
              domain={[30, 90]}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  if (data.predictedDb === null) return null;
                  return (
                    <div className="bg-white dark:bg-zinc-800 p-3 rounded-xl shadow-xl border border-zinc-100 dark:border-zinc-700">
                      <p className="text-sm font-bold mb-1">{label}</p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-300">
                        Predicted:{" "}
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          {data.predictedDb} dB
                        </span>
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        Confidence: {Math.round(data.confidence * 100)}%
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            {data.recommendedHours.map((hour) => {
              const label = `${hour.toString().padStart(2, "0")}:00`;
              return (
                <ReferenceArea
                  key={hour}
                  x1={label}
                  x2={label} // Since AreaChart groups by points, ReferenceArea with x1=x2 creates a line/highlight
                  strokeOpacity={0.3}
                  fill="#22c55e"
                  fillOpacity={0.1}
                />
              );
            })}
            <Area
              type="monotone"
              dataKey="predictedDb"
              stroke="#3b82f6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorDb)"
              connectNulls={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ForecastLegend />
    </div>
  );
}
