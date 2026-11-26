'use client';

import React, { useMemo, useState } from 'react';
import { summarizePingTelemetry } from '@/lib/wifi/jitter';

export interface VenueWifiStatsProps {
  downloadMbps: number;
  uploadMbps?: number;
  pingSamplesMs: number[];
  ssid?: string;
  className?: string;
}

export const VenueWifiStats: React.FC<VenueWifiStatsProps> = ({
  downloadMbps,
  uploadMbps,
  pingSamplesMs,
  ssid,
  className = '',
}) => {
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const summary = useMemo(
    () => summarizePingTelemetry(pingSamplesMs),
    [pingSamplesMs]
  );

  const stabilityPercent = Math.round(
    Math.min(100, Math.max(8, 100 - (summary.jitterMs / 60) * 100))
  );

  const tierStyles =
    summary.tier === 'excellent'
      ? {
          badge:
            'border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/60 dark:text-emerald-300',
          bar: 'bg-emerald-500 dark:bg-emerald-400',
        }
      : summary.tier === 'fair'
      ? {
          badge:
            'border-amber-300/80 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-300',
          bar: 'bg-amber-500 dark:bg-amber-400',
        }
      : {
          badge:
            'border-rose-300/80 bg-rose-50 text-rose-900 dark:border-rose-700/60 dark:bg-rose-950/60 dark:text-rose-300',
          bar: 'bg-rose-500 dark:bg-rose-400',
        };

  return (
    <section
      aria-label="Venue WiFi stability and speed"
      data-testid="venue-wifi-stats"
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              WiFi & Ping Stability
            </h3>
            {ssid && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {ssid}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            ↓ {downloadMbps} Mbps
            {typeof uploadMbps === 'number' ? ` · ↑ ${uploadMbps} Mbps` : ''} · Avg{' '}
            {summary.avgPingMs}ms ping
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            aria-expanded={tooltipOpen}
            aria-label="What is latency jitter?"
            data-testid="jitter-tooltip-trigger"
            onClick={() => setTooltipOpen((prev) => !prev)}
            onMouseEnter={() => setTooltipOpen(true)}
            onMouseLeave={() => setTooltipOpen(false)}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <span data-testid="jitter-value-label">{summary.jitterMs}ms jitter</span>
            <span aria-hidden="true" className="text-slate-400">
              ⓘ
            </span>
          </button>

          {tooltipOpen && (
            <div
              role="tooltip"
              data-testid="jitter-tooltip-popover"
              className="absolute right-0 z-20 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <p className="font-semibold text-slate-900 dark:text-white">
                Why jitter matters
              </p>
              <p className="mt-1 leading-relaxed">{summary.guidanceText}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span
          role="status"
          data-testid="wifi-stability-badge"
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tierStyles.badge}`}
        >
          {summary.statusLabel}
        </span>
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Stability {stabilityPercent}%
        </span>
      </div>

      <div
        role="meter"
        aria-label="Ping stability gauge"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={stabilityPercent}
        data-testid="wifi-stability-gauge"
        className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      >
        <div
          data-testid="wifi-stability-fill"
          style={{ width: `${stabilityPercent}%` }}
          className={`h-full rounded-full transition-all duration-300 ${tierStyles.bar}`}
        />
      </div>
    </section>
  );
};

export default VenueWifiStats;
