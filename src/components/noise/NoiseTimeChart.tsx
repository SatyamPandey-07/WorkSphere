"use client";

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NoiseTimeChartBucket {
  label: string;
  averageDb: number | null;
  peakDb: number | null;
  samples: number;
}

export interface NoiseTimeChartProps {
  venueId: string;
  initialBuckets?: NoiseTimeChartBucket[];
  className?: string;
  onLoaded?: (buckets: NoiseTimeChartBucket[]) => void;
  onError?: (error: Error) => void;
}

export function NoiseTimeChart({
  venueId,
  initialBuckets,
  className,
  onLoaded,
  onError,
}: NoiseTimeChartProps) {
  const [buckets, setBuckets] = useState<NoiseTimeChartBucket[]>(
    initialBuckets ?? []
  );
  const [loading, setLoading] = useState<boolean>(!initialBuckets);

  useEffect(() => {
    if (initialBuckets) {
      setBuckets(initialBuckets);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    fetch(`/api/venues/${encodeURIComponent(venueId)}/noise-metrics`)
      .then(async (response) => {
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load noise metrics");
        }

        if (active) {
          const safeBuckets = Array.isArray(payload.buckets)
            ? payload.buckets
            : [];
          setBuckets(safeBuckets);
          onLoaded?.(safeBuckets);
        }
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        if (active) {
          onError?.(err);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [venueId, initialBuckets, onLoaded, onError]);

  const safeBuckets = Array.isArray(buckets) ? buckets : [];
  const values = safeBuckets.filter(
    (bucket) => bucket.averageDb !== null && !isNaN(bucket.averageDb)
  );
  const peakValues = values
    .map((bucket) => bucket.peakDb ?? 0)
    .filter((v) => !isNaN(v));
  const maxDb = Math.max(...peakValues, 100);

  return (
    <section
      data-testid="noise-time-chart"
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Volume2 className="h-5 w-5 text-blue-500" />
        <div>
          <h3 className="font-semibold text-zinc-900 dark:text-white">
            Community Noise Pattern
          </h3>
          <p className="text-xs text-zinc-500">
            Crowdsourced measured noise by time of day
          </p>
        </div>
      </div>

      {loading ? (
        <p
          data-testid="noise-time-chart-loading"
          className="mt-5 text-sm text-zinc-500"
        >
          Loading noise data…
        </p>
      ) : values.length === 0 ? (
        <p
          data-testid="noise-time-chart-empty"
          className="mt-5 text-sm text-zinc-500"
        >
          No measured noise samples yet. Be the first contributor.
        </p>
      ) : (
        <div
          data-testid="noise-time-chart-list"
          className="mt-5 space-y-4"
        >
          {safeBuckets.map((bucket) => {
            const rawDb = bucket.averageDb ?? 0;
            const width =
              bucket.averageDb !== null && !isNaN(rawDb) && maxDb > 0
                ? Math.max(8, Math.min(100, (rawDb / maxDb) * 100))
                : 0;

            return (
              <div
                key={bucket.label}
                data-testid={`noise-time-chart-row-${bucket.label}`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <span
                    data-testid={`noise-time-chart-label-${bucket.label}`}
                    className="text-zinc-700 dark:text-zinc-300"
                  >
                    {bucket.label}
                  </span>

                  <span
                    data-testid={`noise-time-chart-stat-${bucket.label}`}
                    className="text-xs text-zinc-500"
                  >
                    {bucket.averageDb !== null
                      ? `${bucket.averageDb.toFixed(1)} dB avg · ${bucket.samples} sample${bucket.samples === 1 ? "" : "s"}`
                      : "No samples"}
                  </span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    data-testid={`noise-time-chart-bar-${bucket.label}`}
                    className="h-full rounded-full accent-bg transition-all"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default NoiseTimeChart;
