import React from "react";
import { Wifi, VolumeX, Plug, Activity } from "lucide-react";
import type { Venue } from "@/types/venue";

export type CollectionVenueItem =
  | { venue: Venue }
  | (Venue & { venue?: Venue })
  | Record<string, unknown>;

export interface MetricsWidgetProps {
  venues?: CollectionVenueItem[] | null;
  title?: string;
  isCompact?: boolean;
  className?: string;
  testId?: string;
}

export interface CalculatedMetrics {
  speed: number | null;
  quietness: number | null;
  outlets: number | null;
}

export function calculateMetrics(
  venues?: CollectionVenueItem[] | null,
): CalculatedMetrics {
  if (!venues || !Array.isArray(venues) || venues.length === 0) {
    return { speed: null, quietness: null, outlets: null };
  }

  let totalSpeed = 0;
  let speedCount = 0;

  let totalQuietness = 0;
  let quietnessCount = 0;

  let outletsCount = 0;
  let validVenueCount = 0;

  venues.forEach((v) => {
    if (!v || typeof v !== "object") return;

    // Support both { venue: Venue } shape and direct Venue shape
    const itemAsRecord = v as Record<string, unknown>;
    const venueObj = (
      itemAsRecord.venue && typeof itemAsRecord.venue === "object"
        ? itemAsRecord.venue
        : itemAsRecord
    ) as Partial<Venue>;

    validVenueCount++;

    // Wi-Fi speed calculation
    if (
      venueObj.wifiSpeed !== null &&
      venueObj.wifiSpeed !== undefined &&
      typeof venueObj.wifiSpeed === "number" &&
      !isNaN(venueObj.wifiSpeed) &&
      venueObj.wifiSpeed >= 0
    ) {
      totalSpeed += venueObj.wifiSpeed;
      speedCount++;
    }

    // Noise level scoring
    if (typeof venueObj.noiseLevel === "string" && venueObj.noiseLevel.trim()) {
      const level = venueObj.noiseLevel.trim().toLowerCase();
      let score = 3;
      if (level === "quiet") score = 5;
      else if (level === "moderate") score = 3;
      else if (level === "loud") score = 1;

      totalQuietness += score;
      quietnessCount++;
    }

    // Outlets availability
    if (venueObj.hasOutlets === true) {
      outletsCount++;
    }
  });

  if (validVenueCount === 0) {
    return { speed: null, quietness: null, outlets: null };
  }

  const speed = speedCount > 0 ? Math.round(totalSpeed / speedCount) : null;
  const quietness =
    quietnessCount > 0
      ? Number((totalQuietness / quietnessCount).toFixed(1))
      : null;
  const outlets =
    validVenueCount > 0
      ? Math.round((outletsCount / validVenueCount) * 100)
      : null;

  return { speed, quietness, outlets };
}

export function MetricsWidget({
  venues,
  title = "Collection Metrics",
  isCompact = false,
  className = "",
  testId = "metrics-widget",
}: MetricsWidgetProps) {
  const { speed, quietness, outlets } = calculateMetrics(venues);

  return (
    <section
      role="region"
      aria-label={title}
      data-testid={testId}
      className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm h-full flex flex-col justify-center ${className}`.trim()}
    >
      <h3
        data-testid={`${testId}-title`}
        className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2 mb-4"
      >
        <Activity className="w-5 h-5 text-indigo-500 shrink-0" aria-hidden="true" />
        <span
          className="truncate block max-w-[200px] sm:max-w-[280px]"
          title={title}
        >
          {title}
        </span>
      </h3>

      <div
        data-testid={`${testId}-grid`}
        className={`grid ${isCompact ? "grid-cols-1 gap-3" : "grid-cols-3 gap-4"}`}
      >
        {/* Speed Card */}
        <div
          data-testid={`${testId}-speed-card`}
          className="flex flex-col items-center justify-center p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-800"
        >
          <Wifi className="w-6 h-6 text-blue-500 mb-2" aria-hidden="true" />
          <div
            data-testid={`${testId}-speed-value`}
            className="text-xl font-bold text-zinc-900 dark:text-white"
          >
            {speed !== null ? `${speed} Mbps` : "--"}
          </div>
          <div className="text-xs text-zinc-500 font-medium">Avg Speed</div>
        </div>

        {/* Quietness Card */}
        <div
          data-testid={`${testId}-quietness-card`}
          className="flex flex-col items-center justify-center p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-800"
        >
          <VolumeX className="w-6 h-6 text-purple-500 mb-2" aria-hidden="true" />
          <div
            data-testid={`${testId}-quietness-value`}
            className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-1"
          >
            {quietness !== null ? quietness : "--"}
            {quietness !== null && (
              <span className="text-sm text-yellow-500" aria-hidden="true">
                ★
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 font-medium">Avg Quietness</div>
        </div>

        {/* Outlets Card */}
        <div
          data-testid={`${testId}-outlets-card`}
          className="flex flex-col items-center justify-center p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-800"
        >
          <Plug className="w-6 h-6 text-green-500 mb-2" aria-hidden="true" />
          <div
            data-testid={`${testId}-outlets-value`}
            className="text-xl font-bold text-zinc-900 dark:text-white"
          >
            {outlets !== null ? `${outlets}%` : "--"}
          </div>
          <div className="text-xs text-zinc-500 font-medium">Outlet Avail.</div>
        </div>
      </div>
    </section>
  );
}

export default MetricsWidget;
