"use client";

import React, { useEffect, useState } from "react";
import { Compass, Check } from "lucide-react";
import {
  getStoredDistanceUnit,
  setStoredDistanceUnit,
  type DistanceUnit,
} from "@/lib/geo/formatDistance";

export function DistanceUnitToggle() {
  const [unit, setUnit] = useState<DistanceUnit>("METRIC");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setUnit(getStoredDistanceUnit());
    setMounted(true);

    const handleUnitChange = (e: Event) => {
      const customEvent = e as CustomEvent<DistanceUnit>;
      if (customEvent.detail) {
        setUnit(customEvent.detail);
      }
    };

    window.addEventListener("worksphere_distance_unit_change", handleUnitChange);
    return () => {
      window.removeEventListener("worksphere_distance_unit_change", handleUnitChange);
    };
  }, []);

  const handleSelect = (newUnit: DistanceUnit) => {
    setUnit(newUnit);
    setStoredDistanceUnit(newUnit);
  };

  if (!mounted) {
    return null;
  }

  // Dynamic preview calculation: 1.5 km = 0.93 mi vs 1.0 mi = 1.61 km
  const previewText =
    unit === "METRIC"
      ? "Preview: 1.5 km ≈ 0.93 mi (approx. 18 min walk)"
      : "Preview: 1.0 mi ≈ 1.61 km (approx. 20 min walk)";

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Distance Units
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Choose how walking and driving distances are formatted across WorkSphere.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-2">
        <button
          type="button"
          onClick={() => handleSelect("METRIC")}
          aria-pressed={unit === "METRIC"}
          aria-label="Select Kilometers (km)"
          className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
            unit === "METRIC"
              ? "border-blue-600 bg-blue-50/50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300"
              : "border-zinc-200 dark:border-zinc-800 bg-transparent text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700"
          }`}
        >
          <div className="flex flex-col text-left">
            <span>Kilometers (km)</span>
            <span className="text-[11px] text-zinc-400">e.g. 1.2 km, 500 m</span>
          </div>
          {unit === "METRIC" && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
        </button>

        <button
          type="button"
          onClick={() => handleSelect("IMPERIAL")}
          aria-pressed={unit === "IMPERIAL"}
          aria-label="Select Miles (mi)"
          className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
            unit === "IMPERIAL"
              ? "border-blue-600 bg-blue-50/50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300"
              : "border-zinc-200 dark:border-zinc-800 bg-transparent text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700"
          }`}
        >
          <div className="flex flex-col text-left">
            <span>Miles (mi)</span>
            <span className="text-[11px] text-zinc-400">e.g. 0.8 mi, 350 ft</span>
          </div>
          {unit === "IMPERIAL" && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
        </button>
      </div>

      {/* Live Sample Preview Chip */}
      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
        <span
          data-testid="distance-preview-chip"
          aria-label={`Current distance conversion sample: ${previewText}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" aria-hidden="true" />
          <span>{previewText}</span>
        </span>
      </div>
    </div>
  );
}

export default DistanceUnitToggle;
