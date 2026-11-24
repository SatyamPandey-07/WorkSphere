'use client';

import React from 'react';
import {
  aggregateVenueTelemetry,
  type VenueTelemetrySample,
} from '@/lib/telemetry/venueTelemetryEngine';

export interface VenueTelemetryCardProps {
  venueName: string;
  samples: readonly (VenueTelemetrySample | null | undefined)[];
  baselineKwh?: number;
}

export const VenueTelemetryCard: React.FC<VenueTelemetryCardProps> = ({
  venueName,
  samples,
  baselineKwh = 1000,
}) => {
  const stats = aggregateVenueTelemetry(samples, baselineKwh);

  if (stats.sampleCount === 0) {
    return (
      <section
        data-testid="venue-telemetry-card"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
          {venueName}
        </h3>
        <p
          data-testid="telemetry-empty-state"
          className="mt-2 text-sm text-slate-500 dark:text-slate-400"
        >
          No telemetry samples recorded yet
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="venue-telemetry-card"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {venueName}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ↓ {stats.avgDownloadMbps.toFixed(1)} Mbps · ↑{' '}
            {stats.avgUploadMbps.toFixed(1)} Mbps · {stats.avgLatencyMs.toFixed(1)} ms
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="telemetry-acoustic-badge"
            className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
          >
            {stats.acousticRating} ({stats.avgNoiseDb.toFixed(1)} dB)
          </span>
          {stats.overagePercent > 0 && (
            <span
              data-testid="telemetry-overage-badge"
              className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
            >
              +{stats.overagePercent}% above baseline
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          data-testid="telemetry-baseline-bar"
          style={{ width: `${stats.clampedBarPercent}%` }}
          className="h-full rounded-full bg-emerald-500 transition-all"
        />
      </div>

      {stats.anomalies.length > 0 && (
        <p
          data-testid="telemetry-anomaly-count"
          className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400"
        >
          {stats.anomalies.length} anomaly spike(s) detected
        </p>
      )}
    </section>
  );
};

export default VenueTelemetryCard;
