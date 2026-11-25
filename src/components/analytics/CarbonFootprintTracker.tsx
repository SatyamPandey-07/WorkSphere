'use client';

import React from 'react';

export interface CarbonFootprintTrackerProps {
  venueName?: string;
  actualKwh: number;
  baselineKwh: number;
  carbonKg?: number;
  periodLabel?: string;
  className?: string;
}

export const CarbonFootprintTracker: React.FC<CarbonFootprintTrackerProps> = ({
  venueName = 'Venue Energy Usage',
  actualKwh,
  baselineKwh,
  carbonKg,
  periodLabel = 'Current cycle',
  className = '',
}) => {
  const safeActual = Number.isFinite(actualKwh) ? Math.max(0, actualKwh) : 0;
  const safeBaseline =
    Number.isFinite(baselineKwh) && baselineKwh > 0 ? baselineKwh : 1;

  const rawPercentage = (safeActual / safeBaseline) * 100;
  const clampedWidthPercent = Math.min(100, Math.max(0, rawPercentage));
  const isOverBaseline = rawPercentage > 100;
  const overagePercent = Math.round(rawPercentage - 100);

  return (
    <section
      aria-label={`${venueName} carbon footprint tracker`}
      data-testid="carbon-footprint-tracker"
      className={`w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900 sm:text-base dark:text-slate-100">
            {venueName}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {periodLabel} · {safeActual.toLocaleString('en-IN')} /{' '}
            {safeBaseline.toLocaleString('en-IN')} kWh baseline
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="energy-usage-percentage"
            className="text-xs font-semibold text-slate-700 sm:text-sm dark:text-slate-200"
          >
            {Math.round(rawPercentage)}%
          </span>

          {isOverBaseline && (
            <span
              data-testid="above-baseline-badge"
              className="inline-flex items-center rounded-full border border-amber-300/80 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-300"
            >
              +{overagePercent}% above baseline
            </span>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="Energy consumption relative to baseline"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clampedWidthPercent)}
        data-testid="energy-progress-track"
        className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      >
        <div
          data-testid="energy-progress-fill"
          style={{ width: `${clampedWidthPercent}%` }}
          className={`h-full rounded-full transition-all duration-300 ${
            isOverBaseline
              ? 'bg-amber-500 dark:bg-amber-400'
              : 'bg-emerald-500 dark:bg-emerald-400'
          }`}
        />
      </div>

      {typeof carbonKg === 'number' && Number.isFinite(carbonKg) && (
        <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
          Estimated emissions:{' '}
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {carbonKg.toLocaleString('en-IN')} kg CO₂e
          </span>
        </p>
      )}
    </section>
  );
};

export default CarbonFootprintTracker;
