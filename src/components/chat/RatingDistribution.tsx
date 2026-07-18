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

export function RatingDistribution({
  reviews,
  activeMetric,
  onClose,
}: RatingDistributionProps) {
  const totalReviews = reviews.length;

  // 1. WiFi Quality Distribution (1 to 5 stars)
  const wifiCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach((r) => {
    const q = Math.round(r.wifiQuality);
    if (q >= 1 && q <= 5) {
      wifiCounts[q as 1 | 2 | 3 | 4 | 5]++;
    }
  });

  // 2. Quietness/Noise Distribution (quiet, moderate, loud)
  const noiseCounts = { quiet: 0, moderate: 0, loud: 0 };
  reviews.forEach((r) => {
    const level = r.noiseLevel?.toLowerCase();
    if (level === "quiet") noiseCounts.quiet++;
    else if (level === "loud") noiseCounts.loud++;
    else noiseCounts.moderate++; // default or moderate
  });

  // 3. Outlet Availability Distribution (Yes / No)
  const outletCounts = { yes: 0, no: 0 };
  const densityCounts = {
    every_table: 0,
    some_tables: 0,
    wall_seats: 0,
    none: 0,
  };

  reviews.forEach((r) => {
    if (r.hasOutlets) {
      outletCounts.yes++;
    } else {
      outletCounts.no++;
    }

    const density = r.outletDensity;
    if (density === "every_table") densityCounts.every_table++;
    else if (density === "some_tables") densityCounts.some_tables++;
    else if (density === "wall_seats") densityCounts.wall_seats++;
    else densityCounts.none++;
  });

  const getPercentage = (count: number) => {
    if (totalReviews === 0) return 0;
    return Math.round((count / totalReviews) * 100);
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-5 mt-4 animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {activeMetric === "wifi" && (
            <>
              <Wifi className="w-5 h-5 text-blue-500 animate-pulse" />
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
                WiFi Quality Distribution
              </h3>
            </>
          )}
          {activeMetric === "outlets" && (
            <>
              <Zap className="w-5 h-5 text-orange-500 animate-pulse" />
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
                Power Outlet Distribution
              </h3>
            </>
          )}
          {activeMetric === "noise" && (
            <>
              <Volume2 className="w-5 h-5 text-pink-500 animate-pulse" />
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
        <div className="space-y-3.5">
          {activeMetric === "wifi" &&
            ([5, 4, 3, 2, 1] as const).map((stars) => {
              const count = wifiCounts[stars];
              const pct = getPercentage(count);
              return (
                <div key={stars} className="flex items-center gap-3">
                  <span className="w-12 text-[11px] font-black text-zinc-500 dark:text-zinc-400 flex items-center justify-end gap-1">
                    {stars}{" "}
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0" />
                  </span>
                  <div className="flex-1 h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-[11px] font-black text-zinc-600 dark:text-zinc-300">
                    {pct}% ({count})
                  </span>
                </div>
              );
            })}

          {activeMetric === "noise" &&
            (
              [
                { key: "quiet", label: "Quiet" },
                { key: "moderate", label: "Moderate" },
                { key: "loud", label: "Loud" },
              ] as const
            ).map(({ key, label }) => {
              const count = noiseCounts[key];
              const pct = getPercentage(count);
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-16 text-left text-[11px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    {label}
                  </span>
                  <div className="flex-1 h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ease-out ${
                        key === "quiet"
                          ? "bg-emerald-600 dark:bg-emerald-500"
                          : key === "moderate"
                            ? "bg-amber-500 dark:bg-amber-400"
                            : "bg-rose-600 dark:bg-rose-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-[11px] font-black text-zinc-600 dark:text-zinc-300">
                    {pct}% ({count})
                  </span>
                </div>
              );
            })}

          {activeMetric === "outlets" && (
            <div className="space-y-4">
              <div className="space-y-3.5">
                <div className="text-[10px] font-black tracking-widest uppercase text-zinc-400 mb-1">
                  Availability
                </div>
                {(
                  [
                    { key: "yes", label: "Available" },
                    { key: "no", label: "Unavailable" },
                  ] as const
                ).map(({ key, label }) => {
                  const count = outletCounts[key];
                  const pct = getPercentage(count);
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-20 text-left text-[11px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        {label}
                      </span>
                      <div className="flex-1 h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ease-out ${
                            key === "yes"
                              ? "bg-orange-500"
                              : "bg-zinc-400 dark:bg-zinc-600"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-[11px] font-black text-zinc-600 dark:text-zinc-300">
                        {pct}% ({count})
                      </span>
                    </div>
                  );
                })}
              </div>

              {reviews.some((r) => r.outletDensity) && (
                <div className="space-y-3.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  <div className="text-[10px] font-black tracking-widest uppercase text-zinc-400 mb-1">
                    Outlet Density
                  </div>
                  {(
                    [
                      { key: "every_table", label: "Every Table" },
                      { key: "some_tables", label: "Some Tables" },
                      { key: "wall_seats", label: "Wall Seats" },
                      { key: "none", label: "None" },
                    ] as const
                  ).map(({ key, label }) => {
                    const count = densityCounts[key];
                    const pct = getPercentage(count);
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-20 text-left text-[11px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                          {label}
                        </span>
                        <div className="flex-1 h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-[11px] font-black text-zinc-600 dark:text-zinc-300">
                          {pct}% ({count})
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
