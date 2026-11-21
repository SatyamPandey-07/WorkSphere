'use client';

import React from 'react';
import { calculateCarbonSavingsPercent } from '@/lib/analytics';

export interface CarbonFootprintTrackerProps {
  baselineKg: number;
  actualKg: number;
  tripCount?: number;
  className?: string;
}

export const CarbonFootprintTracker: React.FC<CarbonFootprintTrackerProps> = ({
  baselineKg,
  actualKg,
  tripCount = 0,
  className = '',
}) => {
  const safeBaseline = Number.isFinite(baselineKg) && baselineKg > 0 ? baselineKg : 0;
  const safeActual = Number.isFinite(actualKg) && actualKg >= 0 ? actualKg : 0;
  const savingsPercent = calculateCarbonSavingsPercent(safeBaseline, safeActual);
  const formattedSavings = `${Number.isInteger(savingsPercent) ? savingsPercent : savingsPercent.toFixed(1)}%`;

  return (
    <section
      aria-label="Carbon Footprint Summary"
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          Commute Carbon Reduction
        </h2>
        <span className="text-xs text-slate-500">{tripCount} trips logged</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Baseline</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {safeBaseline.toFixed(1)} kg
          </p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Actual</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {safeActual.toFixed(1)} kg
          </p>
        </div>

        <div
          data-testid="carbon-savings-stat"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"
        >
          <p className="text-xs font-medium text-emerald-800">Savings</p>
          <p
            data-testid="carbon-savings-value"
            className="mt-1 text-lg font-bold text-emerald-950"
          >
            {formattedSavings}
          </p>
        </div>
      </div>
    </section>
  );
};