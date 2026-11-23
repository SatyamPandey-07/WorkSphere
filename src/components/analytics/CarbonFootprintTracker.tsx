"use client";

import React, { useMemo, useState } from "react";

export type CarbonPresetKey = "7d" | "30d" | "this-month" | "ytd";

export interface CarbonDailyMetric {
  date: string; // YYYY-MM-DD
  baselineKgCo2: number;
  actualKgCo2: number;
}

export interface CarbonSavingsSummary {
  daysCount: number;
  baselineKgCo2: number;
  actualKgCo2: number;
  savedKgCo2: number;
  savingsPercent: number;
}

export interface CarbonFootprintTrackerProps {
  dailyMetrics?: CarbonDailyMetric[];
  dailyBaselineKgCo2?: number;
  dailyActualKgCo2?: number;
  defaultPreset?: CarbonPresetKey;
  todayIso?: string;
  className?: string;
}

const MS_PER_DAY = 86_400_000;

export function toIsoDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDateUtc(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

export function getInclusiveDaysCount(
  startIso: string,
  endIso: string,
): number {
  const start = parseIsoDateUtc(startIso);
  const end = parseIsoDateUtc(endIso);
  if (!start || !end || start.getTime() > end.getTime()) return 0;
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

export function getPresetDateRange(
  preset: CarbonPresetKey,
  todayIso: string,
): { startDate: string; endDate: string } {
  const endDt = parseIsoDateUtc(todayIso) ?? new Date();
  const endDate = toIsoDateString(endDt);

  if (preset === "7d") {
    const startDt = new Date(endDt.getTime() - 6 * MS_PER_DAY);
    return { startDate: toIsoDateString(startDt), endDate };
  }
  if (preset === "30d") {
    const startDt = new Date(endDt.getTime() - 29 * MS_PER_DAY);
    return { startDate: toIsoDateString(startDt), endDate };
  }
  if (preset === "this-month") {
    const startDt = new Date(
      Date.UTC(endDt.getUTCFullYear(), endDt.getUTCMonth(), 1),
    );
    return { startDate: toIsoDateString(startDt), endDate };
  }
  const startDt = new Date(Date.UTC(endDt.getUTCFullYear(), 0, 1));
  return { startDate: toIsoDateString(startDt), endDate };
}

export function validateCustomDateRange(
  startDate: string,
  endDate: string,
  maxDateIso: string,
): string | null {
  if (!startDate || !endDate) {
    return "Please select both a start date and an end date.";
  }
  const start = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);
  const maxDt = parseIsoDateUtc(maxDateIso);

  if (!start || !end) {
    return "Please enter valid calendar dates in YYYY-MM-DD format.";
  }
  if (start.getTime() > end.getTime()) {
    return "Start date must be on or before the end date.";
  }
  if (
    maxDt &&
    (start.getTime() > maxDt.getTime() || end.getTime() > maxDt.getTime())
  ) {
    return "Dates cannot be in the future.";
  }
  return null;
}

export function computeCarbonSavingsForRange(
  startDate: string,
  endDate: string,
  options: {
    dailyMetrics?: CarbonDailyMetric[];
    dailyBaselineKgCo2?: number;
    dailyActualKgCo2?: number;
  } = {},
): CarbonSavingsSummary {
  const daysCount = getInclusiveDaysCount(startDate, endDate);
  if (daysCount <= 0) {
    return {
      daysCount: 0,
      baselineKgCo2: 0,
      actualKgCo2: 0,
      savedKgCo2: 0,
      savingsPercent: 0,
    };
  }

  const matchingRows = (options.dailyMetrics ?? []).filter(
    (row) => row.date >= startDate && row.date <= endDate,
  );

  let baselineKgCo2 = 0;
  let actualKgCo2 = 0;

  if (matchingRows.length > 0) {
    for (const row of matchingRows) {
      baselineKgCo2 += row.baselineKgCo2;
      actualKgCo2 += row.actualKgCo2;
    }
  } else {
    const basePerDay = options.dailyBaselineKgCo2 ?? 12.5;
    const actualPerDay = options.dailyActualKgCo2 ?? 4.2;
    baselineKgCo2 = Number((basePerDay * daysCount).toFixed(2));
    actualKgCo2 = Number((actualPerDay * daysCount).toFixed(2));
  }

  const savedKgCo2 = Number(
    Math.max(0, baselineKgCo2 - actualKgCo2).toFixed(2),
  );
  const savingsPercent =
    baselineKgCo2 > 0
      ? Number(((savedKgCo2 / baselineKgCo2) * 100).toFixed(1))
      : 0;

  return {
    daysCount,
    baselineKgCo2: Number(baselineKgCo2.toFixed(2)),
    actualKgCo2: Number(actualKgCo2.toFixed(2)),
    savedKgCo2,
    savingsPercent,
  };
}

const PRESET_BUTTONS: { key: CarbonPresetKey; label: string }[] = [
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
  { key: "this-month", label: "This Month" },
  { key: "ytd", label: "YTD" },
];

export const CarbonFootprintTracker: React.FC<CarbonFootprintTrackerProps> = ({
  dailyMetrics,
  dailyBaselineKgCo2,
  dailyActualKgCo2,
  defaultPreset = "30d",
  todayIso: propTodayIso,
  className = "",
}) => {
  const resolvedToday = propTodayIso ?? toIsoDateString(new Date());
  const initialRange = getPresetDateRange(defaultPreset, resolvedToday);

  const [activePreset, setActivePreset] = useState<CarbonPresetKey | null>(
    defaultPreset,
  );
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSelectPreset = (preset: CarbonPresetKey) => {
    const nextRange = getPresetDateRange(preset, resolvedToday);
    setActivePreset(preset);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
    setValidationError(null);
  };

  const handleToggleCustom = () => {
    setIsCustomOpen((prev) => {
      const nextOpen = !prev;
      if (nextOpen) {
        setActivePreset(null);
      }
      return nextOpen;
    });
  };

  const applyCustomDates = (nextStart: string, nextEnd: string) => {
    setStartDate(nextStart);
    setEndDate(nextEnd);
    setActivePreset(null);

    const err = validateCustomDateRange(nextStart, nextEnd, resolvedToday);
    setValidationError(err);
  };

  const summary = useMemo(() => {
    if (validationError) {
      return {
        daysCount: 0,
        baselineKgCo2: 0,
        actualKgCo2: 0,
        savedKgCo2: 0,
        savingsPercent: 0,
      };
    }
    return computeCarbonSavingsForRange(startDate, endDate, {
      dailyMetrics,
      dailyBaselineKgCo2,
      dailyActualKgCo2,
    });
  }, [
    validationError,
    startDate,
    endDate,
    dailyMetrics,
    dailyBaselineKgCo2,
    dailyActualKgCo2,
  ]);

  return (
    <section
      data-testid="carbon-footprint-tracker"
      className={`rounded-2xl border border-slate-800 bg-slate-950 p-5 text-slate-100 shadow-lg ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            Carbon Savings Tracker
          </h2>
          <p className="text-xs text-slate-400">
            Baseline vs. actual emissions ({startDate} to {endDate})
          </p>
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Date range presets"
        >
          {PRESET_BUTTONS.map((btn) => {
            const isSelected = activePreset === btn.key;
            return (
              <button
                key={btn.key}
                type="button"
                data-testid={`preset-${btn.key}`}
                aria-pressed={isSelected}
                onClick={() => handleSelectPreset(btn.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  isSelected
                    ? "bg-emerald-500 text-slate-950"
                    : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 hover:text-white"
                }`}
              >
                {btn.label}
              </button>
            );
          })}

          <button
            type="button"
            data-testid="custom-range-toggle"
            aria-expanded={isCustomOpen}
            aria-pressed={isCustomOpen && activePreset === null}
            onClick={handleToggleCustom}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              isCustomOpen && activePreset === null
                ? "bg-indigo-500 text-white"
                : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 hover:text-white"
            }`}
          >
            Custom
          </button>
        </div>
      </div>

      {isCustomOpen && (
        <div
          data-testid="custom-date-controls"
          className="mt-4 rounded-xl border border-slate-800 bg-slate-900/90 p-3.5"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-300">
              <span>Start Date</span>
              <input
                type="date"
                data-testid="custom-start-date"
                max={resolvedToday}
                value={startDate}
                onChange={(e) => applyCustomDates(e.target.value, endDate)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-300">
              <span>End Date</span>
              <input
                type="date"
                data-testid="custom-end-date"
                max={resolvedToday}
                value={endDate}
                onChange={(e) => applyCustomDates(startDate, e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none"
              />
            </label>
          </div>

          {validationError && (
            <p
              role="alert"
              data-testid="custom-date-error"
              className="mt-2.5 text-xs font-medium text-rose-400"
            >
              {validationError}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">Baseline Emissions</div>
          <div
            data-testid="baseline-emissions"
            className="mt-1 text-lg font-semibold text-slate-200"
          >
            {summary.baselineKgCo2.toFixed(2)} kg CO₂
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">Actual Emissions</div>
          <div
            data-testid="actual-emissions"
            className="mt-1 text-lg font-semibold text-slate-200"
          >
            {summary.actualKgCo2.toFixed(2)} kg CO₂
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">Net Carbon Saved</div>
          <div
            data-testid="saved-emissions"
            className="mt-1 text-lg font-semibold text-emerald-400"
          >
            {summary.savedKgCo2.toFixed(2)} kg CO₂ ({summary.savingsPercent}%)
          </div>
        </div>
      </div>
    </section>
  );
};

export default CarbonFootprintTracker;
