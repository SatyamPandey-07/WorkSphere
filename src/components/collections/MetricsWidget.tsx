import React from "react";
import { Wifi, VolumeX, Plug, Activity } from "lucide-react";

interface Venue {
  wifiSpeed?: number | null;
  noiseLevel?: string | null;
  hasOutlets?: boolean;
}

interface MetricsWidgetProps {
  venues: { venue: Venue }[];
  title?: string;
  isCompact?: boolean;
}

export function calculateMetrics(venues: { venue: Venue }[]) {
  if (!venues || venues.length === 0)
    return { speed: null, quietness: null, outlets: null };

  let totalSpeed = 0;
  let speedCount = 0;

  let totalQuietness = 0;
  let quietnessCount = 0;

  let outletsCount = 0;

  venues.forEach((v) => {
    const venue = v.venue;
    if (venue.wifiSpeed !== null && venue.wifiSpeed !== undefined) {
      totalSpeed += venue.wifiSpeed;
      speedCount++;
    }

    if (venue.noiseLevel) {
      const level = venue.noiseLevel.toLowerCase();
      let score = 3;
      if (level === "quiet") score = 5;
      if (level === "moderate") score = 3;
      if (level === "loud") score = 1;
      totalQuietness += score;
      quietnessCount++;
    }

    if (venue.hasOutlets) {
      outletsCount++;
    }
  });

  const speed = speedCount > 0 ? Math.round(totalSpeed / speedCount) : null;
  const quietness =
    quietnessCount > 0
      ? Number((totalQuietness / quietnessCount).toFixed(1))
      : null;
  const outlets = Math.round((outletsCount / venues.length) * 100);

  return { speed, quietness, outlets };
}

export function MetricsWidget({
  venues,
  title = "Collection Metrics",
  isCompact = false,
}: MetricsWidgetProps) {
  const { speed, quietness, outlets } = calculateMetrics(venues);
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm h-full flex flex-col justify-center">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-indigo-500 shrink-0" />
        <span
          className="truncate block max-w-[200px] sm:max-w-[280px]"
          title={title}
        >
          {title}
        </span>
      </h3>

      <div
        className={`grid ${isCompact ? "grid-cols-1 gap-3" : "grid-cols-3 gap-4"}`}
      >
        <div className="flex flex-col items-center justify-center p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-800">
          <Wifi className="w-6 h-6 text-blue-500 mb-2" />
          <div className="text-xl font-bold text-zinc-900 dark:text-white">
            {speed !== null ? `${speed} Mbps` : "--"}
          </div>
          <div className="text-xs text-zinc-500 font-medium">Avg Speed</div>
        </div>

        <div className="flex flex-col items-center justify-center p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-800">
          <VolumeX className="w-6 h-6 text-purple-500 mb-2" />
          <div className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-1">
            {quietness !== null ? quietness : "--"}
            {quietness !== null && (
              <span className="text-sm text-yellow-500">★</span>
            )}
          </div>
          <div className="text-xs text-zinc-500 font-medium">Avg Quietness</div>
        </div>

        <div className="flex flex-col items-center justify-center p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-800">
          <Plug className="w-6 h-6 text-green-500 mb-2" />
          <div className="text-xl font-bold text-zinc-900 dark:text-white">
            {outlets !== null ? `${outlets}%` : "--"}
          </div>
          <div className="text-xs text-zinc-500 font-medium">Outlet Avail.</div>
        </div>
      </div>
    </div>
  );
}
