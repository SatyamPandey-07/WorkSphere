"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Battery, BatteryCharging, BatteryLow, Leaf, Zap } from "lucide-react";
import {
  LOW_BATTERY_THRESHOLD,
  useBatteryOptimization,
} from "@/hooks/useBatteryOptimization";

export interface BatterySaverIndicatorProps {
  className?: string;
  initialOverrideDisabled?: boolean;
  mockBattery?: {
    level: number;
    charging: boolean;
  };
}

export function BatterySaverIndicator({
  className = "",
  initialOverrideDisabled = false,
  mockBattery,
}: BatterySaverIndicatorProps) {
  const optimizationState = useBatteryOptimization();

  const [isOpen, setIsOpen] = useState(false);
  const [manualDisabled, setManualDisabled] = useState(initialOverrideDisabled);
  const containerRef = useRef<HTMLDivElement>(null);

  const level =
    mockBattery !== undefined
      ? mockBattery.level
      : optimizationState.batteryLevel;
  const isCharging =
    mockBattery !== undefined
      ? mockBattery.charging
      : optimizationState.isCharging;

  // Active when on battery power or battery level below threshold
  const isEligible =
    typeof level === "number" &&
    Number.isFinite(level) &&
    (isCharging === false || level <= LOW_BATTERY_THRESHOLD);

  const isSaverActive = isEligible && !manualDisabled;

  // Close popover when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const toggleSaver = useCallback(() => {
    setManualDisabled((prev) => !prev);
  }, []);

  if (!isEligible) {
    return null;
  }

  const percentage = Math.round(level * 100);
  const powerStatusText = isCharging ? "Charging" : "On Battery";
  const ariaLabelText = `Battery saver ${
    isSaverActive ? "active" : "disabled"
  }, ${percentage}% ${powerStatusText}`;

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center shrink-0 ${className}`.trim()}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={ariaLabelText}
        data-testid="battery-saver-indicator-btn"
        className={`inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 ${
          isSaverActive
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 hover:bg-amber-500/20"
            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
        }`}
      >
        {isCharging ? (
          <BatteryCharging
            className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
            aria-hidden="true"
          />
        ) : level <= LOW_BATTERY_THRESHOLD ? (
          <BatteryLow
            className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 animate-pulse"
            aria-hidden="true"
          />
        ) : (
          <Battery className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
        <span data-testid="battery-saver-percentage" className="tabular-nums">
          {percentage}%
        </span>
        {isSaverActive && (
          <Leaf
            className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0"
            aria-hidden="true"
            data-testid="battery-saver-leaf-icon"
          />
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Battery saver details"
          data-testid="battery-saver-popover"
          className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg z-50 animate-in fade-in zoom-in-95 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-500" aria-hidden="true" />
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Battery Saver
              </span>
            </div>
            <span
              data-testid="battery-saver-status-tag"
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                isSaverActive
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              {isSaverActive ? "ACTIVE" : "OFF"}
            </span>
          </div>

          <div className="mt-2.5 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">
                Battery Level:
              </span>
              <span
                data-testid="battery-level-display"
                className="font-medium text-slate-900 dark:text-slate-100"
              >
                {percentage}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">
                Power Source:
              </span>
              <span
                data-testid="battery-power-source-display"
                className="font-medium text-slate-900 dark:text-slate-100"
              >
                {powerStatusText}
              </span>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              role="switch"
              aria-checked={!manualDisabled}
              onClick={toggleSaver}
              data-testid="battery-saver-toggle-btn"
              className="w-full text-center px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700/80 transition-colors text-slate-800 dark:text-slate-200"
            >
              {manualDisabled
                ? "Enable battery saving"
                : "Temporarily disable battery saving"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default BatterySaverIndicator;
