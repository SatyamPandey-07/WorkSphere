"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Gauge, RefreshCw, Download } from "lucide-react";
import {
  AggregatedWebVitals,
  WebVitalMetricName,
  WebVitalRating,
  WEB_VITALS_THRESHOLDS,
  generateDefaultWebVitalsData,
  recordWebVital,
  MetricSummary,
} from "@/lib/webVitalsCollector";
import { downloadWebVitalsCSV } from "@/lib/export/domain/systemVitalsExporter";

export interface WebVitalsWidgetProps {
  initialRange?: string;
  className?: string;
  autoRefreshMs?: number;
}

function getRatingBadgeStyle(rating: WebVitalRating) {
  switch (rating) {
    case "good":
      return {
        bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        dot: "bg-emerald-400",
        label: "Good",
        color: "#10b981",
      };
    case "needs-improvement":
      return {
        bg: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        dot: "bg-amber-400",
        label: "Needs Improvement",
        color: "#f59e0b",
      };
    case "poor":
      return {
        bg: "bg-red-500/10 text-red-400 border-red-500/20",
        dot: "bg-red-400",
        label: "Poor",
        color: "#ef4444",
      };
  }
}

function formatValue(name: WebVitalMetricName, val: number): string {
  const threshold = WEB_VITALS_THRESHOLDS[name];
  if (threshold.unit === "score") {
    return val.toFixed(3);
  }
  if (val < 1000) {
    return `${Math.round(val)} ms`;
  }
  return `${(val / 1000).toFixed(2)} s`;
}

/**
 * Score Radial Circular Gauge Component
 */
function ScoreRadialGauge({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  let strokeColor = "#10b981"; // Emerald
  let label = "Good";
  let labelBg = "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";

  if (score < 50) {
    strokeColor = "#ef4444"; // Red
    label = "Poor";
    labelBg = "text-red-400 border-red-500/30 bg-red-500/10";
  } else if (score < 90) {
    strokeColor = "#f59e0b"; // Amber
    label = "Needs Improvement";
    labelBg = "text-amber-400 border-amber-500/30 bg-amber-500/10";
  }

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="relative flex items-center justify-center">
        <svg className="h-36 w-36 -rotate-90 transform" viewBox="0 0 120 120">
          <circle
            cx="60"
            cy="60"
            r={radius}
            className="stroke-zinc-800"
            strokeWidth="10"
            fill="transparent"
          />
          <circle
            cx="60"
            cy="60"
            r={radius}
            stroke={strokeColor}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className="text-4xl font-bold tracking-tight text-white font-mono">
            {score}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium mt-0.5">
            Out of 100
          </span>
        </div>
      </div>
      <div
        className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${labelBg}`}
      >
        <span
          className="h-2 w-2 rounded-full animate-pulse"
          style={{ backgroundColor: strokeColor }}
        />
        {label}
      </div>
    </div>
  );
}

/**
 * Metric Card with Status Gauge and Percentile breakdown (p50, p75, p90)
 */
function WebVitalGaugeCard({ summary }: { summary: MetricSummary }) {
  const { name, p50, p75, p90, rating, sampleCount, distribution } = summary;
  const badge = getRatingBadgeStyle(rating);
  const threshold = WEB_VITALS_THRESHOLDS[name];

  // Derive percent towards good threshold scale
  const maxScale = threshold.needsImprovement * 1.25;
  const p75Percent = Math.min(100, (p75 / maxScale) * 100);

  return (
    <article
      data-testid={`vital-card-${name}`}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col justify-between hover:border-white/20 transition-colors"
    >
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-white tracking-wide">
              {name}
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">
              ({threshold.unit})
            </span>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.bg}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
            {badge.label}
          </span>
        </div>

        {/* p75 Core Metric Value */}
        <div className="my-3 flex items-baseline justify-between">
          <div>
            <span className="text-2xl font-bold font-mono text-white">
              {formatValue(name, p75)}
            </span>
            <span className="ml-2 text-xs text-zinc-400 font-sans">
              p75 standard
            </span>
          </div>
          <span className="text-xs text-zinc-500">{sampleCount} samples</span>
        </div>

        {/* Status Gauge Visual Bar */}
        <div className="my-2 relative">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800 flex relative">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${p75Percent}%`,
                backgroundColor: badge.color,
              }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-zinc-500 font-mono">
            <span>Good: &le;{formatValue(name, threshold.good)}</span>
            <span>
              Poor: &gt;{formatValue(name, threshold.needsImprovement)}
            </span>
          </div>
        </div>

        {/* Percentile Breakdown (p50, p75, p90) */}
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-zinc-900/60 p-2 text-center text-xs">
          <div>
            <span className="block text-[10px] text-zinc-400 uppercase font-medium">
              p50
            </span>
            <span className="font-mono text-zinc-200 font-semibold">
              {formatValue(name, p50)}
            </span>
          </div>
          <div className="border-x border-zinc-800">
            <span className="block text-[10px] text-violet-400 uppercase font-bold">
              p75
            </span>
            <span className="font-mono text-violet-200 font-bold">
              {formatValue(name, p75)}
            </span>
          </div>
          <div>
            <span className="block text-[10px] text-zinc-400 uppercase font-medium">
              p90
            </span>
            <span className="font-mono text-zinc-200 font-semibold">
              {formatValue(name, p90)}
            </span>
          </div>
        </div>

        {/* Distribution Bar */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
            <span>Distribution</span>
            <span className="text-emerald-400">{distribution.good}% Good</span>
          </div>
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              style={{ width: `${distribution.good}%` }}
              className="bg-emerald-500 h-full"
              title={`Good: ${distribution.good}%`}
            />
            <div
              style={{ width: `${distribution.needsImprovement}%` }}
              className="bg-amber-500 h-full"
              title={`Needs Improvement: ${distribution.needsImprovement}%`}
            />
            <div
              style={{ width: `${distribution.poor}%` }}
              className="bg-red-500 h-full"
              title={`Poor: ${distribution.poor}%`}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

export interface TimeframeOption {
  label: string;
  value: string;
}

export const TIMEFRAME_OPTIONS: TimeframeOption[] = [
  { label: "24 Hours", value: "24h" },
  { label: "7 Days", value: "7d" },
  { label: "30 Days", value: "30d" },
];

/**
 * Skeleton shimmer placeholder displayed while loading or refetching historical metrics
 */
export function WebVitalsSkeletonShimmer() {
  return (
    <div
      data-testid="web-vitals-skeleton"
      className="mt-6 space-y-6 animate-pulse"
      aria-label="Loading Web Vitals historical metrics..."
    >
      {/* Top Banner Skeleton */}
      <div className="grid gap-6 md:grid-cols-3 bg-zinc-950/40 border border-white/10 rounded-2xl p-5">
        <div className="md:col-span-1 border-r border-white/10 pr-4 flex flex-col items-center justify-center">
          <div className="h-3 w-32 bg-zinc-800/80 rounded mb-4" />
          <div className="h-32 w-32 rounded-full border-8 border-zinc-800/80 flex items-center justify-center">
            <div className="h-10 w-16 bg-zinc-800/80 rounded" />
          </div>
          <div className="h-6 w-28 bg-zinc-800/80 rounded-full mt-3" />
        </div>

        <div className="md:col-span-2 flex flex-col justify-center space-y-3.5 pl-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-white/5 pb-2.5"
            >
              <div className="h-3.5 w-44 bg-zinc-800/80 rounded" />
              <div className="h-4 w-20 bg-zinc-800/80 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Metric Cards Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-20 bg-zinc-800/80 rounded" />
              <div className="h-4 w-16 bg-zinc-800/80 rounded-full" />
            </div>
            <div className="h-8 w-28 bg-zinc-800/80 rounded mt-2" />
            <div className="h-2 w-full bg-zinc-800/80 rounded-full" />
            <div className="grid grid-cols-3 gap-2 p-2 bg-zinc-900/60 rounded-xl">
              <div className="h-6 bg-zinc-800/80 rounded" />
              <div className="h-6 bg-zinc-800/80 rounded" />
              <div className="h-6 bg-zinc-800/80 rounded" />
            </div>
            <div className="h-2 w-full bg-zinc-800/80 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WebVitalsWidget({
  initialRange = "24h",
  className = "",
  autoRefreshMs = 30000,
}: WebVitalsWidgetProps) {
  const [range, setRange] = useState(initialRange);
  const [data, setData] = useState<AggregatedWebVitals | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"gauges" | "routes">("gauges");

  const fetchVitals = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/vitals?range=${range}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        setData(generateDefaultWebVitalsData(range));
      }
    } catch {
      setData(generateDefaultWebVitalsData(range));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    fetchVitals();
    const interval = setInterval(fetchVitals, autoRefreshMs);
    return () => clearInterval(interval);
  }, [fetchVitals, autoRefreshMs]);

  const handleTimeframeChange = (newRange: string) => {
    if (newRange === range) return;
    setRange(newRange);
    setLoading(true);
  };

  const handleSimulateSample = () => {
    recordWebVital({
      name: "LCP",
      value: Math.floor(1200 + Math.random() * 2000),
      rating: "good",
      delta: 1500,
      route: "/venues",
    });
    recordWebVital({
      name: "INP",
      value: Math.floor(40 + Math.random() * 180),
      rating: "good",
      delta: 60,
      route: "/chat",
    });
    fetchVitals();
  };

  const metricKeys: WebVitalMetricName[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];

  return (
    <section
      data-testid="web-vitals-widget"
      className={`rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-xl ${className}`}
    >
      {/* Header Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <Gauge className="h-6 w-6 text-violet-400" />
            <h2 className="text-xl font-bold tracking-tight text-white">
              Google Web Vitals Performance Score Widget
            </h2>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Real-world user performance distributions, p50/p75/p90 percentiles,
            and route status gauges.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tabs */}
          <div className="flex rounded-xl bg-zinc-900/80 p-1 border border-white/10 text-xs">
            <button
              onClick={() => setActiveTab("gauges")}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                activeTab === "gauges"
                  ? "bg-violet-600 text-white shadow"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Status Gauges
            </button>
            <button
              onClick={() => setActiveTab("routes")}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                activeTab === "routes"
                  ? "bg-violet-600 text-white shadow"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Route Distributions
            </button>
          </div>

          {/* Timeframe Filter Segmented Control */}
          <div
            role="group"
            aria-label="Timeframe selector"
            data-testid="timeframe-segmented-control"
            className="flex rounded-xl bg-zinc-900/80 p-1 border border-white/10 text-xs"
          >
            {TIMEFRAME_OPTIONS.map((tf) => {
              const isSelected = range === tf.value;
              return (
                <button
                  key={tf.value}
                  type="button"
                  aria-pressed={isSelected}
                  data-testid={`timeframe-option-${tf.value}`}
                  onClick={() => handleTimeframeChange(tf.value)}
                  className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                    isSelected
                      ? "bg-zinc-800 text-violet-300 font-bold shadow-sm"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {tf.label}
                </button>
              );
            })}
          </div>

          {/* Export CSV button */}
          <button
            onClick={() => data && downloadWebVitalsCSV(data)}
            disabled={!data || loading}
            className="p-2 rounded-xl border border-white/10 bg-zinc-900/80 text-zinc-400 hover:text-white transition-colors disabled:opacity-40"
            title="Export Web Vitals telemetry as CSV"
            aria-label="Export Web Vitals telemetry as CSV"
          >
            <Download className="h-4 w-4 text-violet-400" />
          </button>

          {/* Refresh button */}
          <button
            onClick={fetchVitals}
            disabled={refreshing}
            className="p-2 rounded-xl border border-white/10 bg-zinc-900/80 text-zinc-400 hover:text-white transition-colors"
            title="Refresh Web Vitals metrics"
            aria-label="Refresh Web Vitals metrics"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin text-violet-400" : ""}`}
            />
          </button>
        </div>
      </div>

      {loading || refreshing ? (
        <WebVitalsSkeletonShimmer />
      ) : data ? (
        <div className="mt-6">
          {/* Top Score Banner */}
          <div className="grid gap-6 md:grid-cols-3 bg-zinc-950/40 border border-white/10 rounded-2xl p-5 mb-6">
            <div className="md:col-span-1 border-r border-white/10 pr-4 flex flex-col items-center justify-center">
              <span className="text-xs text-zinc-400 font-medium mb-1 uppercase tracking-wider">
                Overall Web Vitals Score
              </span>
              <ScoreRadialGauge score={data.overallScore} />
            </div>

            <div className="md:col-span-2 flex flex-col justify-center space-y-3 pl-2">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs text-zinc-400">
                  Total Samples Evaluated
                </span>
                <span className="text-sm font-bold font-mono text-zinc-200">
                  {data.totalSamples.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs text-zinc-400">
                  Primary Core Web Vital (LCP p75)
                </span>
                <span className="text-sm font-bold font-mono text-emerald-400">
                  {data.metrics.LCP
                    ? formatValue("LCP", data.metrics.LCP.p75)
                    : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs text-zinc-400">
                  Responsiveness Metric (INP p75)
                </span>
                <span className="text-sm font-bold font-mono text-violet-400">
                  {data.metrics.INP
                    ? formatValue("INP", data.metrics.INP.p75)
                    : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">
                  Visual Stability (CLS p75)
                </span>
                <span className="text-sm font-bold font-mono text-cyan-400">
                  {data.metrics.CLS
                    ? formatValue("CLS", data.metrics.CLS.p75)
                    : "N/A"}
                </span>
              </div>
            </div>
          </div>

          {/* Active Tab View */}
          {activeTab === "gauges" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-200">
                  Core Web Vitals Status Gauges (p50 / p75 / p90)
                </h3>
                <button
                  onClick={handleSimulateSample}
                  className="text-xs text-violet-400 hover:text-violet-300 underline font-mono"
                >
                  + Record Test Sample
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {metricKeys.map((key) => {
                  const summary = data.metrics[key];
                  if (!summary) return null;
                  return <WebVitalGaugeCard key={key} summary={summary} />;
                })}
              </div>
            </div>
          )}

          {activeTab === "routes" && (
            <div>
              <h3 className="text-sm font-semibold text-zinc-200 mb-4">
                Route-by-Route Web Vitals Performance Breakdown
              </h3>
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-zinc-950/40">
                <table className="w-full text-left text-xs text-zinc-300">
                  <thead className="border-b border-white/10 bg-zinc-900/60 font-semibold text-zinc-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Route</th>
                      <th className="px-4 py-3">Samples</th>
                      <th className="px-4 py-3">Score</th>
                      <th className="px-4 py-3">LCP (p75)</th>
                      <th className="px-4 py-3">INP (p75)</th>
                      <th className="px-4 py-3">CLS (p75)</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono">
                    {data.routes.map((r) => {
                      const lcpVal = r.metrics.LCP?.p75;
                      const inpVal = r.metrics.INP?.p75;
                      const clsVal = r.metrics.CLS?.p75;

                      let statusBadge =
                        "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                      let statusText = "Good";
                      if (r.score < 50) {
                        statusBadge =
                          "bg-red-500/10 text-red-400 border-red-500/20";
                        statusText = "Poor";
                      } else if (r.score < 90) {
                        statusBadge =
                          "bg-amber-500/10 text-amber-400 border-amber-500/20";
                        statusText = "Needs Imp.";
                      }

                      return (
                        <tr key={r.route} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-3 font-sans font-medium text-white">
                            {r.route}
                          </td>
                          <td className="px-4 py-3 text-zinc-400">
                            {r.sampleCount}
                          </td>
                          <td className="px-4 py-3 font-bold text-violet-300">
                            {r.score}
                          </td>
                          <td className="px-4 py-3 text-zinc-300">
                            {lcpVal !== undefined
                              ? formatValue("LCP", lcpVal)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-zinc-300">
                            {inpVal !== undefined
                              ? formatValue("INP", inpVal)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-zinc-300">
                            {clsVal !== undefined
                              ? formatValue("CLS", clsVal)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 font-sans">
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge}`}
                            >
                              {statusText}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="mt-4 text-[11px] text-zinc-500 flex items-center justify-between">
            <span>
              Web Vitals collected client-side via PerformanceObserver according
              to Google Web Vitals 2026 specifications.
            </span>
            <span>
              Generated: {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default WebVitalsWidget;
