"use client";

import { useMemo, useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { Volume2, Sun, Moon, Info, Sparkles } from "lucide-react";
import type { HourlyForecast } from "@/lib/noiseForecast";

export interface AmbientNoiseTrendGraphProps {
  /**
   * Venue ID to fetch noise forecast if data is not supplied directly.
   */
  venueId?: string;
  /**
   * Hourly noise data (can be passed from parent or fetched via venueId).
   */
  forecast?: HourlyForecast[];
  /**
   * Title displayed above the graph.
   */
  title?: string;
  /**
   * Initial active time bracket filter: "all" (8 AM - 10 PM), "morning" (8 AM - 2 PM), or "evening" (2 PM - 10 PM).
   */
  defaultBracket?: "all" | "morning" | "evening";
}

export interface HourlyNoiseBarPoint {
  hour: number;
  label: string;
  period: "morning" | "evening";
  medianDb: number | null;
  samples: number;
  confidence: number;
  color: string;
  statusText: string;
}

/**
 * Returns color according to noise threshold:
 * - Green (<50 dB): Quiet
 * - Yellow (50-70 dB): Moderate
 * - Orange (>70 dB): Loud
 */
export function getNoiseLevelColor(db: number | null): string {
  if (db === null) return "#71717a"; // muted zinc for missing
  if (db < 50) return "#22c55e"; // Green (< 50 dB)
  if (db <= 70) return "#eab308"; // Yellow (50 - 70 dB)
  return "#f97316"; // Orange (> 70 dB)
}

export function getNoiseLevelCategory(db: number | null): string {
  if (db === null) return "No Data";
  if (db < 50) return "Quiet (<50 dB)";
  if (db <= 70) return "Moderate (50-70 dB)";
  return "Loud (>70 dB)";
}

export function AmbientNoiseTrendGraph({
  venueId,
  forecast: initialForecast,
  title = "Ambient Noise Decibel Trend",
  defaultBracket = "all",
}: AmbientNoiseTrendGraphProps) {
  const [forecastData, setForecastData] = useState<HourlyForecast[]>(
    initialForecast || [],
  );
  const [loading, setLoading] = useState<boolean>(!initialForecast && !!venueId);
  const [timeBracket, setTimeBracket] = useState<"all" | "morning" | "evening">(
    defaultBracket,
  );

  useEffect(() => {
    if (initialForecast) {
      setForecastData(initialForecast);
      setLoading(false);
      return;
    }

    if (!venueId) return;

    let active = true;
    setLoading(true);

    fetch(`/api/venues/${encodeURIComponent(venueId)}/noise-metrics/forecast`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.forecast) {
          setForecastData(json.forecast);
        }
      })
      .catch((err) => {
        console.error("Failed to load noise metrics forecast:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [venueId, initialForecast]);

  // Transform 8:00 AM (hour 8) to 10:00 PM (hour 22)
  const chartPoints: HourlyNoiseBarPoint[] = useMemo(() => {
    const points: HourlyNoiseBarPoint[] = [];

    // Filter hours from 8 (8 AM) to 22 (10 PM)
    for (let h = 8; h <= 22; h++) {
      const match = forecastData.find((f) => f.hour === h);
      const isMorning = h < 14; // 8 AM to 1:59 PM is Morning; 2 PM to 10 PM is Evening
      const period: "morning" | "evening" = isMorning ? "morning" : "evening";

      // If user selected bracket, filter out non-matching hours
      if (timeBracket === "morning" && period !== "morning") continue;
      if (timeBracket === "evening" && period !== "evening") continue;

      const hour12 = h % 12 === 0 ? 12 : h % 12;
      const ampm = h < 12 ? "AM" : "PM";
      const label = `${hour12} ${ampm}`;

      const dbValue =
        match?.medianDb !== undefined && match?.medianDb !== null
          ? match.medianDb
          : match?.predictedDb !== undefined && match?.predictedDb !== null
          ? match.predictedDb
          : null;

      points.push({
        hour: h,
        label,
        period,
        medianDb: dbValue,
        samples: match?.samples ?? 0,
        confidence: match?.confidence ?? 0,
        color: getNoiseLevelColor(dbValue),
        statusText: getNoiseLevelCategory(dbValue),
      });
    }

    return points;
  }, [forecastData, timeBracket]);

  const quietestHour = useMemo(() => {
    const valid = chartPoints.filter((p) => p.medianDb !== null);
    if (valid.length === 0) return null;
    return valid.reduce((min, cur) =>
      (cur.medianDb ?? 999) < (min.medianDb ?? 999) ? cur : min,
    );
  }, [chartPoints]);

  return (
    <div className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm sm:text-base flex items-center gap-2">
              <span>{title}</span>
              {quietestHour && quietestHour.medianDb !== null && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                  <Sparkles className="w-3 h-3" />
                  Quietest: {quietestHour.label} ({quietestHour.medianDb} dB)
                </span>
              )}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Crowdsourced audio calibration trend (8:00 AM – 10:00 PM)
            </p>
          </div>
        </div>

        {/* Morning vs Evening filter pills */}
        <div className="inline-flex rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1 text-xs self-start sm:self-auto border border-zinc-200 dark:border-zinc-700/60">
          <button
            type="button"
            onClick={() => setTimeBracket("all")}
            className={`px-3 py-1 rounded-lg font-medium transition-all ${
              timeBracket === "all"
                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            All Hours
          </button>
          <button
            type="button"
            onClick={() => setTimeBracket("morning")}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg font-medium transition-all ${
              timeBracket === "morning"
                ? "bg-white dark:bg-zinc-900 text-amber-600 dark:text-amber-400 shadow-sm"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            Morning (8 AM–2 PM)
          </button>
          <button
            type="button"
            onClick={() => setTimeBracket("evening")}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg font-medium transition-all ${
              timeBracket === "evening"
                ? "bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-sm"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            Evening (2 PM–10 PM)
          </button>
        </div>
      </div>

      {/* Chart Section */}
      {loading ? (
        <div className="h-56 w-full flex items-center justify-center text-sm text-zinc-400">
          Loading ambient noise trend…
        </div>
      ) : chartPoints.length === 0 ? (
        <div className="h-56 w-full flex items-center justify-center text-sm text-zinc-500">
          No noise calibration samples available for this bracket.
        </div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartPoints}
              margin={{ top: 15, right: 10, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#e4e4e7"
                className="dark:stroke-zinc-800"
              />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#71717a" }}
              />
              <YAxis
                domain={[30, 90]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#71717a" }}
                tickFormatter={(v) => `${v} dB`}
              />
              <Tooltip
                cursor={{ fill: "rgba(0, 0, 0, 0.04)" }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as HourlyNoiseBarPoint;
                    return (
                      <div className="bg-white dark:bg-zinc-800 p-3 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700 text-xs space-y-1">
                        <p className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                          {data.period === "morning" ? (
                            <Sun className="w-3.5 h-3.5 text-amber-500" />
                          ) : (
                            <Moon className="w-3.5 h-3.5 text-indigo-400" />
                          )}
                          {data.label}
                        </p>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: data.color }}
                          />
                          <span className="font-semibold text-sm">
                            {data.medianDb !== null
                              ? `${data.medianDb} dB`
                              : "No data"}
                          </span>
                          <span className="text-zinc-500 text-[11px]">
                            ({data.statusText})
                          </span>
                        </div>
                        {data.samples > 0 && (
                          <p className="text-[10px] text-zinc-400">
                            Based on {data.samples} calibration sample
                            {data.samples === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {/* Threshold indicator lines */}
              <ReferenceLine
                y={50}
                stroke="#22c55e"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
              <ReferenceLine
                y={70}
                stroke="#eab308"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
              <Bar dataKey="medianDb" radius={[4, 4, 0, 0]} maxBarSize={32}>
                {chartPoints.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend & Threshold Indicators */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-md bg-green-500" />
            <span className="text-zinc-600 dark:text-zinc-400 font-medium">
              &lt; 50 dB (Quiet)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-md bg-yellow-500" />
            <span className="text-zinc-600 dark:text-zinc-400 font-medium">
              50–70 dB (Moderate)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-md bg-orange-500" />
            <span className="text-zinc-600 dark:text-zinc-400 font-medium">
              &gt; 70 dB (Loud)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-zinc-400">
          <Info className="w-3.5 h-3.5" />
          <span>Recommended for focus work: Green (&lt;50 dB)</span>
        </div>
      </div>
    </div>
  );
}
