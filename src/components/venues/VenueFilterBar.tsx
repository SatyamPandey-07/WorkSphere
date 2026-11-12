"use client";

import React, { useState } from "react";
import { SlidersHorizontal, X, RotateCcw } from "lucide-react";
import NoiseLevelSlider, {
  MAX_DB_LIMIT,
  MIN_DB_LIMIT,
} from "./NoiseLevelSlider";

export interface VenueFilterState {
  minDb: number;
  maxDb: number;
}

interface VenueFilterBarProps {
  filters: VenueFilterState;
  onFilterChange: (next: VenueFilterState) => void;
  onReset: () => void;
}

export const VenueFilterBar: React.FC<VenueFilterBarProps> = ({
  filters,
  onFilterChange,
  onReset,
}) => {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);

  const hasActiveNoiseFilter =
    filters.minDb > MIN_DB_LIMIT || filters.maxDb < MAX_DB_LIMIT;

  return (
    <>
      {/* Desktop Filter Sidebar */}
      <aside
        aria-label="Desktop venue filters"
        className="hidden w-72 shrink-0 space-y-4 lg:block"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Filters
          </h2>
          {hasActiveNoiseFilter && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>

        <NoiseLevelSlider
          minDb={filters.minDb}
          maxDb={filters.maxDb}
          onChange={({ minDb, maxDb }) =>
            onFilterChange({ ...filters, minDb, maxDb })
          }
        />
      </aside>

      {/* Mobile Filter Trigger Bar */}
      <div className="flex items-center justify-between lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobileSheetOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
          <span>Acoustic &amp; Venue Filters</span>
          {hasActiveNoiseFilter && (
            <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[11px] text-cyan-300">
              {filters.minDb}–{filters.maxDb} dB
            </span>
          )}
        </button>
      </div>

      {/* Mobile Filter Bottom Sheet */}
      {isMobileSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mobile venue filters"
          className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/75 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-2xl border-t border-slate-800 bg-slate-900 p-5 text-slate-100 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-semibold">Filter Venues</h2>
              <button
                type="button"
                onClick={() => setIsMobileSheetOpen(false)}
                aria-label="Close mobile filters"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <NoiseLevelSlider
              minDb={filters.minDb}
              maxDb={filters.maxDb}
              onChange={({ minDb, maxDb }) =>
                onFilterChange({ ...filters, minDb, maxDb })
              }
            />

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={onReset}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setIsMobileSheetOpen(false)}
                className="flex-1 rounded-lg bg-cyan-600 py-2.5 text-xs font-semibold text-white hover:bg-cyan-500"
              >
                Show Venues
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default VenueFilterBar;
