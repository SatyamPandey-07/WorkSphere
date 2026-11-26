'use client';

import React from 'react';
import {
  calculateJitterMs,
  clampBaselineRatioPercent,
  type CircuitState,
} from '@/lib/reliability/circuitAndSyncEngine';

export interface SessionHealthPanelProps {
  venueName: string;
  pingSamplesMs: number[];
  actualEnergyKwh: number;
  baselineEnergyKwh: number;
  circuitState: CircuitState;
  queuedMutationsCount: number;
  onSyncNow?: () => void;
}

export const SessionHealthPanel: React.FC<SessionHealthPanelProps> = ({
  venueName,
  pingSamplesMs,
  actualEnergyKwh,
  baselineEnergyKwh,
  circuitState,
  queuedMutationsCount,
  onSyncNow,
}) => {
  const jitterMs = calculateJitterMs(pingSamplesMs);
  const { clampedPercent, overagePercent } = clampBaselineRatioPercent(
    actualEnergyKwh,
    baselineEnergyKwh
  );

  const callQuality =
    jitterMs < 15
      ? 'Excellent for Video Calls'
      : jitterMs <= 45
      ? 'Good for Browsing & Streaming'
      : 'High Jitter — Audio/Video May Stutter';

  return (
    <section
      aria-label="Nomad session reliability panel"
      data-testid="session-health-panel"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {venueName} — Session Health
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Jitter: <strong data-testid="panel-jitter">{jitterMs}ms</strong> ·{' '}
            <span data-testid="panel-call-quality">{callQuality}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            data-testid="panel-circuit-badge"
            className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            RPC: {circuitState}
          </span>
          {onSyncNow && (
            <button
              type="button"
              onClick={onSyncNow}
              data-testid="panel-sync-btn"
              className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Sync ({queuedMutationsCount})
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-600 dark:text-slate-300">
            Energy vs Baseline
          </span>
          {overagePercent > 0 && (
            <span
              data-testid="panel-overage-badge"
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
            >
              +{overagePercent}% above baseline
            </span>
          )}
        </div>
        <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            data-testid="panel-energy-bar"
            style={{ width: `${clampedPercent}%` }}
            className="h-full rounded-full bg-emerald-500 transition-all"
          />
        </div>
      </div>
    </section>
  );
};

export default SessionHealthPanel;
