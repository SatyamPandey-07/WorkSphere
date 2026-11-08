"use client";

import React from "react";

/**
 * Placeholder for a single telemetry metric card. Sized to match the real card
 * (p-8, rounded-[2.5rem]) so swapping it out for the loaded content does not
 * shift the surrounding layout. The shimmer itself comes from the .ws-skeleton
 * class in globals.css, which respects prefers-reduced-motion.
 */
export function MetricCardSkeleton() {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-[2.5rem] shadow-sm">
      <div className="ws-skeleton w-16 h-16 rounded-2xl mb-6" />
      <div className="ws-skeleton w-20 h-3 rounded mb-3" />
      <div className="ws-skeleton w-16 h-8 rounded" />
    </div>
  );
}

/**
 * Placeholder for a chart or forecast panel. The header block mirrors the
 * progress/forecast card on the dashboard, and the body is a single shimmering
 * panel whose height can be adjusted per usage.
 */
export function ChartSkeleton({ height = "h-48" }: { height?: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-[2.5rem] shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="ws-skeleton w-20 h-5 rounded-full" />
            <div className="ws-skeleton w-24 h-3 rounded mt-1" />
          </div>
          <div className="ws-skeleton w-64 h-8 rounded" />
        </div>
        <div className="space-y-3 md:text-right">
          <div className="ws-skeleton w-24 h-3 rounded md:ml-auto" />
        </div>
      </div>
      <div className={`ws-skeleton w-full ${height} rounded-2xl`} />
    </div>
  );
}
