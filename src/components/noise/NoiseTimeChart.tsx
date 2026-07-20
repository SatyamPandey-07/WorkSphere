"use client";

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";

type Bucket = {
  label: string;
  averageDb: number | null;
  peakDb: number | null;
  samples: number;
};

export function NoiseTimeChart({ venueId }: { venueId: string }) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    fetch(`/api/venues/${encodeURIComponent(venueId)}/noise-metrics`)
      .then(async (response) => {
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load noise metrics");
        }

        if (active) {
          setBuckets(payload.buckets);
        }
      })
      .catch((error) => console.error(error))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [venueId]);

  const values = buckets.filter((bucket) => bucket.averageDb !== null);
  const maxDb = Math.max(...values.map((bucket) => bucket.peakDb ?? 0), 100);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
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
        <p className="mt-5 text-sm text-zinc-500">Loading noise data…</p>
      ) : values.length === 0 ? (
        <p className="mt-5 text-sm text-zinc-500">
          No measured noise samples yet. Be the first contributor.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {buckets.map((bucket) => {
            const width = bucket.averageDb
              ? Math.max(8, Math.min(100, (bucket.averageDb / maxDb) * 100))
              : 0;

            return (
              <div key={bucket.label}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {bucket.label}
                  </span>

                  <span className="text-xs text-zinc-500">
                    {bucket.averageDb !== null
                      ? `${bucket.averageDb.toFixed(1)} dB avg · ${bucket.samples} sample${bucket.samples === 1 ? "" : "s"}`
                      : "No samples"}
                  </span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
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
