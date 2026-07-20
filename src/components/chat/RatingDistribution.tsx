"use client";

import React from "react";
import { Star, Wifi, Zap, Volume2, X } from "lucide-react";

interface Review {
  wifiQuality: number;
  hasOutlets: boolean;
  noiseLevel: string;
  outletDensity?: string | null;
}

interface RatingDistributionProps {
  reviews: Review[];
  activeMetric: "wifi" | "outlets" | "noise";
  onClose?: () => void;
}

interface ChartDataPoint {
  label: string;
  value: number;
  color: string;
  icon?: React.ReactNode;
}

function MetricChart({
  title,
  data,
  total,
}: {
  title?: string;
  data: ChartDataPoint[];
  total: number;
}) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;

  // Pre-calculate offsets without mutating variables during render
  const chartItems = data.map((item, index, arr) => {
    const percentage = total === 0 ? 0 : item.value / total;
    const strokeLength = percentage * circumference;
    const offset = arr.slice(0, index).reduce((acc, prev) => {
      return acc + (total === 0 ? 0 : (prev.value / total) * circumference);
    }, 0);
    return { ...item, strokeLength, offset };
  });

  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <div className="relative w-32 h-32 flex shrink-0 items-center justify-center">
        <svg
          width="128"
          height="128"
          viewBox="0 0 100 100"
          className="-rotate-90 transform"
        >
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke="currentColor"
            className="text-zinc-200 dark:text-zinc-800"
            strokeWidth="12"
          />
          {chartItems.map((item, i) => {
            if (item.value === 0) return null;

            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={radius}
                fill="transparent"
                stroke={item.color}
                strokeWidth="12"
                strokeDasharray={`${item.strokeLength} ${circumference - item.strokeLength}`}
                strokeDashoffset={-item.offset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-black text-zinc-800 dark:text-zinc-200 leading-none">
            {total}
          </span>
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-1">
            Ratings
          </span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-3">
        {title && (
          <div className="text-[10px] font-black tracking-widest uppercase text-zinc-400 mb-1 border-b border-zinc-200 dark:border-zinc-800 pb-2">
            {title}
          </div>
        )}
        {data.map((item, i) => {
          const pct = total === 0 ? 0 : Math.round((item.value / total) * 100);
          return (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300 flex items-center gap-1">
                  {item.label} {item.icon}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-20 h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full origin-left"
                    style={{
                      backgroundColor: item.color,
                      transform: `scaleX(${pct / 100})`,
                    }}
                  />
                </div>
                <div className="w-16 text-right text-xs font-black text-zinc-500">
                  {pct}% ({item.value})
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RatingDistribution({
  reviews,
  activeMetric,
  onClose,
}: RatingDistributionProps) {
  const totalReviews = reviews.length;

  const wifiCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  const noiseCounts = { quiet: 0, moderate: 0, loud: 0 };
  const outletCounts = { yes: 0, no: 0 };
  const densityCounts = {
    every_table: 0,
    some_tables: 0,
    wall_seats: 0,
    none: 0,
  };

  reviews.forEach((r) => {
    // WiFi
    const q = Math.round(r.wifiQuality);
    if (q >= 1 && q <= 5) wifiCounts[q as 1 | 2 | 3 | 4 | 5]++;

    // Noise
    const level = r.noiseLevel?.toLowerCase();
    if (level === "quiet") noiseCounts.quiet++;
    else if (level === "loud") noiseCounts.loud++;
    else noiseCounts.moderate++;

    // Outlets
    if (r.hasOutlets) outletCounts.yes++;
    else outletCounts.no++;

    const density = r.outletDensity;
    if (density === "every_table") densityCounts.every_table++;
    else if (density === "some_tables") densityCounts.some_tables++;
    else if (density === "wall_seats") densityCounts.wall_seats++;
    else densityCounts.none++;
  });

  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-5 mt-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {activeMetric === "wifi" && (
            <>
              <Wifi className="w-5 h-5 text-blue-500" />
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
                WiFi Quality Distribution
              </h3>
            </>
          )}
          {activeMetric === "outlets" && (
            <>
              <Zap className="w-5 h-5 text-orange-500" />
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
                Power Outlet Distribution
              </h3>
            </>
          )}
          {activeMetric === "noise" && (
            <>
              <Volume2 className="w-5 h-5 text-pink-500" />
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
                Quietness Distribution
              </h3>
            </>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 rounded-full transition-colors active:scale-95"
            aria-label="Close distribution details"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {totalReviews === 0 ? (
        <div className="py-6 text-center text-zinc-400 dark:text-zinc-500 text-xs font-semibold tracking-wide uppercase">
          No ratings recorded yet to build distribution.
        </div>
      ) : (
        <div className="space-y-6">
          {activeMetric === "wifi" && (
            <MetricChart
              total={totalReviews}
              data={[
                {
                  label: "5 Stars",
                  value: wifiCounts[5],
                  color: "#3b82f6",
                  icon: (
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  ),
                },
                {
                  label: "4 Stars",
                  value: wifiCounts[4],
                  color: "#60a5fa",
                  icon: (
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  ),
                },
                {
                  label: "3 Stars",
                  value: wifiCounts[3],
                  color: "#93c5fd",
                  icon: (
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  ),
                },
                {
                  label: "2 Stars",
                  value: wifiCounts[2],
                  color: "#bfdbfe",
                  icon: (
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  ),
                },
                {
                  label: "1 Star",
                  value: wifiCounts[1],
                  color: "#dbeafe",
                  icon: (
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  ),
                },
              ]}
            />
          )}

          {activeMetric === "noise" && (
            <MetricChart
              total={totalReviews}
              data={[
                { label: "Quiet", value: noiseCounts.quiet, color: "#10b981" },
                {
                  label: "Moderate",
                  value: noiseCounts.moderate,
                  color: "#f59e0b",
                },
                { label: "Loud", value: noiseCounts.loud, color: "#e11d48" },
              ]}
            />
          )}

          {activeMetric === "outlets" && (
            <div className="space-y-8">
              <MetricChart
                title="Availability"
                total={totalReviews}
                data={[
                  {
                    label: "Available",
                    value: outletCounts.yes,
                    color: "#f97316",
                  },
                  {
                    label: "Unavailable",
                    value: outletCounts.no,
                    color: "#a1a1aa",
                  },
                ]}
              />
              {reviews.some((r) => r.outletDensity) && (
                <MetricChart
                  title="Outlet Density"
                  total={totalReviews}
                  data={[
                    {
                      label: "Every Table",
                      value: densityCounts.every_table,
                      color: "#f59e0b",
                    },
                    {
                      label: "Some Tables",
                      value: densityCounts.some_tables,
                      color: "#fbbf24",
                    },
                    {
                      label: "Wall Seats",
                      value: densityCounts.wall_seats,
                      color: "#fcd34d",
                    },
                    {
                      label: "None",
                      value: densityCounts.none,
                      color: "#a1a1aa",
                    },
                  ]}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
