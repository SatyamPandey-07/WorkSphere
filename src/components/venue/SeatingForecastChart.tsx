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
import { Loader2, Star } from "lucide-react";

interface SeatingForecastResult {
  forecast: {
    hour: number;
    predictedOccupancy: number | null;
    confidence: number;
    capacity: number;
  }[];
  recommendedHours: number[];
  capacity: number;
}

interface SeatingForecastChartProps {
  venueId: string;
}

function RecommendedHoursBadge({ hours }: { hours: number[] }) {
  if (hours.length === 0) return null;

  const formattedHours = hours
    .sort((a, b) => a - b)
    .map((h) => `${h.toString().padStart(2, "0")}:00`);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 text-sm text-green-800 dark:text-green-300">
      <div className="flex items-center gap-1.5 font-bold shrink-0">
        <Star className="w-4 h-4 fill-current" />
        <Star className="w-4 h-4 fill-current" />
        <span>Recommended Seating Times:</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {formattedHours.map((h) => (
          <span
            key={h}
            className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-500/20 font-medium"
          >
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}

function ForecastLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 mt-2">
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-indigo-500/20 border border-indigo-500" />
        <span>Predicted Occupancy</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500" />
        <span>Most Available Hours</span>
      </div>
    </div>
  );
}

export function SeatingForecastChart({ venueId }: SeatingForecastChartProps) {
  const [data, setData] = useState<SeatingForecastResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchForecast() {
      try {
        const res = await fetch(`/api/venues/${venueId}/seating-forecast`);
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

  const chartData = data.forecast.map((f) => ({
    hour: `${f.hour.toString().padStart(2, "0")}:00`,
    predictedOccupancy: f.predictedOccupancy,
    confidence: f.confidence,
    rawHour: f.hour,
  }));

  const hasData = chartData.some((d) => d.predictedOccupancy !== null);

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
      <RecommendedHoursBadge hours={data.recommendedHours} />

      <div className="w-full h-64 bg-white dark:bg-zinc-900 rounded-2xl p-4 border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorOccupancy" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
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
              domain={[0, Math.max(10, data.capacity)]}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const pointData = payload[0].payload;
                  if (pointData.predictedOccupancy === null) return null;
                  return (
                    <div className="bg-white dark:bg-zinc-800 p-3 rounded-xl shadow-xl border border-zinc-100 dark:border-zinc-700">
                      <p className="text-sm font-bold mb-1">{label}</p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-300">
                        Occupancy:{" "}
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          {pointData.predictedOccupancy} seats
                        </span>
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        Confidence: {Math.round(pointData.confidence * 100)}%
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
                  x2={label}
                  strokeOpacity={0.3}
                  fill="#22c55e"
                  fillOpacity={0.1}
                />
              );
            })}
            <Area
              type="monotone"
              dataKey="predictedOccupancy"
              stroke="#6366f1"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorOccupancy)"
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
