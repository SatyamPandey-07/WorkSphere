"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Volume2,
  Send,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

type Bucket = {
  key: string;
  label: string;
  averageDb: number | null;
  peakDb: number | null;
  samples: number;
};

interface NoiseReportingWidgetProps {
  venueId: string;
  venueName?: string;
  onSubmitted?: (decibels: number) => void;
}

export function NoiseReportingWidget({
  venueId,
  venueName,
  onSubmitted,
}: NoiseReportingWidgetProps) {
  const [decibels, setDecibels] = useState<number>(50);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/venues/${encodeURIComponent(venueId)}/noise-metrics`,
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load noise metrics");
      }
      if (Array.isArray(data.buckets)) {
        setBuckets(data.buckets);
      }
    } catch (err: any) {
      console.error("Error loading noise metrics:", err);
      setErrorMessage(err.message || "Failed to load noise metrics");
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (venueId) {
      fetchMetrics();
    }
  }, [venueId, fetchMetrics]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/venues/${encodeURIComponent(venueId)}/noise-metrics`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decibels }),
        },
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to submit noise metric");
      }

      setSubmitted(true);
      if (Array.isArray(data.buckets)) {
        setBuckets(data.buckets);
      }
      if (onSubmitted) {
        onSubmitted(decibels);
      }
      setTimeout(() => setSubmitted(false), 4000);
    } catch (err: any) {
      console.error("Error submitting noise metric:", err);
      setErrorMessage(err.message || "Failed to submit reading");
    } finally {
      setSubmitting(false);
    }
  };

  // Noise classification badge helpers
  const getNoiseClassification = (db: number) => {
    if (db < 45) {
      return {
        label: "Quiet (Library / Silent)",
        color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
        barColor: "#10b981",
      };
    }
    if (db <= 65) {
      return {
        label: "Moderate (Cafe Chatter)",
        color: "text-amber-400 bg-amber-500/10 border-amber-500/30",
        barColor: "#f59e0b",
      };
    }
    return {
      label: "Loud (Busy Workspace)",
      color: "text-rose-400 bg-rose-500/10 border-rose-500/30",
      barColor: "#f43f5e",
    };
  };

  const currentClassification = getNoiseClassification(decibels);

  const getBarColor = (db: number | null) => {
    if (db === null) return "#3f3f46";
    if (db < 45) return "#10b981";
    if (db <= 65) return "#f59e0b";
    return "#f43f5e";
  };

  const chartData = buckets.map((bucket) => ({
    label: bucket.label,
    db: bucket.averageDb ?? 0,
    peak: bucket.peakDb ?? 0,
    samples: bucket.samples,
    hasData: bucket.averageDb !== null,
  }));

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90 text-zinc-900 dark:text-zinc-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-zinc-900 dark:text-white leading-tight">
              Live Noise Telemetry Report
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {venueName
                ? `Report noise levels for ${venueName}`
                : "Report current decibel reading"}
            </p>
          </div>
        </div>

        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="p-2 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors"
          title="Refresh Data"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Interactive Decibel Input Slider */}
      <form onSubmit={handleSubmit} className="mb-6 space-y-4">
        <div className="bg-zinc-50 dark:bg-zinc-950/60 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800/80">
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="decibel-slider"
              className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400"
            >
              Observed Decibels (dB)
            </label>
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full border ${currentClassification.color}`}
            >
              {decibels} dB — {currentClassification.label}
            </span>
          </div>

          <input
            id="decibel-slider"
            type="range"
            min={30}
            max={90}
            step={1}
            value={decibels}
            onChange={(e) => setDecibels(Number(e.target.value))}
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
          />

          <div className="flex justify-between text-[10px] text-zinc-400 mt-1 font-mono">
            <span>30 dB (Quiet)</span>
            <span>60 dB (Moderate)</span>
            <span>90 dB (Loud)</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {submitting ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {submitting ? "Submitting Telemetry…" : "Submit Noise Update"}
        </button>

        {submitted && (
          <div className="flex items-center gap-2 p-3 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl animate-in fade-in">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>
              Noise telemetry submitted successfully! Live chart updated.
            </span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 p-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </form>

      {/* Historic Noise Level Averages by Time of Day (Recharts Bar Chart) */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-2">
          Historic Averages by Time of Day
        </h4>

        {loading ? (
          <div className="h-44 flex items-center justify-center text-xs text-zinc-500">
            Loading noise pattern chart…
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-xs text-zinc-500">
            No noise telemetry data available yet.
          </div>
        ) : (
          <div className="h-44 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#888888" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(val) => `${val}dB`}
                  tick={{ fontSize: 10, fill: "#888888" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-zinc-900 border border-zinc-700 p-2.5 rounded-lg shadow-xl text-xs">
                          <p className="font-bold text-white">{data.label}</p>
                          {data.hasData ? (
                            <>
                              <p className="text-blue-400 font-medium">
                                Avg: {data.db} dB
                              </p>
                              {data.peak > 0 && (
                                <p className="text-amber-400 text-[10px]">
                                  Peak: {data.peak} dB
                                </p>
                              )}
                              <p className="text-[10px] text-zinc-400 mt-1">
                                {data.samples} sample
                                {data.samples === 1 ? "" : "s"}
                              </p>
                            </>
                          ) : (
                            <p className="text-zinc-500 italic">No samples</p>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="db" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={getBarColor(entry.hasData ? entry.db : null)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
