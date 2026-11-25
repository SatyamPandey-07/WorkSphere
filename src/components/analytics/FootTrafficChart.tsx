'use client';

import React from 'react';
import {
  exportFootTrafficToCsv,
  type FootTrafficPoint,
} from '@/lib/analytics/exportCsv';

export interface FootTrafficChartProps {
  venueName: string;
  trafficData: FootTrafficPoint[];
  className?: string;
}

export const FootTrafficChart: React.FC<FootTrafficChartProps> = ({
  venueName,
  trafficData,
  className = '',
}) => {
  const hasData = trafficData.length > 0;

  const handleExport = () => {
    if (!hasData) return;
    exportFootTrafficToCsv(trafficData, venueName);
  };

  return (
    <section
      aria-label={`${venueName} foot traffic analytics`}
      data-testid="foot-traffic-chart"
      className={`w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 sm:text-base dark:text-slate-100">
            {venueName} — Hourly Foot Traffic
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Historical occupancy, capacity load, and desk turnover rate
          </p>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={!hasData}
          data-testid="export-foot-traffic-csv-btn"
          aria-label="Export CSV"
          className="inline-flex min-h-[38px] items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4 shrink-0"
          >
            <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
          </svg>
          <span>Export CSV</span>
        </button>
      </div>

      {hasData ? (
        <div
          role="list"
          aria-label="Hourly occupancy breakdown"
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6"
        >
          {trafficData.map((point, idx) => {
            const clampedBar = Math.min(100, Math.max(0, point.capacityPercentage));
            return (
              <div
                key={`${point.date}-${point.hour}-${idx}`}
                role="listitem"
                className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-800/50"
              >
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  <span>{point.hour}</span>
                  <span>{point.occupancyCount} pax</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    style={{ width: `${clampedBar}%` }}
                    className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400"
                  />
                </div>
                <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                  {point.capacityPercentage}% cap · {point.deskTurnoverRate}x
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          No historical foot traffic records available for export.
        </p>
      )}
    </section>
  );
};

export default FootTrafficChart;
