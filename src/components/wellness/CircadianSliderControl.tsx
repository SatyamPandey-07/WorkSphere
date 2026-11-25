"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { RotateCcw, Sliders, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MIN_KELVIN,
  MAX_KELVIN,
  getScheduleKelvin,
  kelvinToRgb,
} from "./CircadianLightingCard";

export interface CircadianSliderControlProps {
  /**
   * Controlled temperature in Kelvin (2700 to 6500).
   * When omitted, the component manages its temperature internally.
   */
  value?: number;
  /**
   * Initial default temperature in Kelvin when uncontrolled.
   * If not provided, initializes to the current solar schedule Kelvin.
   */
  defaultValue?: number;
  /**
   * Callback fired whenever the temperature changes (either via slider or reset).
   */
  onChange?: (kelvin: number) => void;
  /**
   * Controlled manual override flag.
   */
  isManualOverride?: boolean;
  /**
   * Default manual override state when uncontrolled. Default: false.
   */
  defaultManualOverride?: boolean;
  /**
   * Callback fired when manual override state changes.
   */
  onManualOverrideChange?: (isOverride: boolean) => void;
  /**
   * Callback fired when the user clicks "Reset to Solar Schedule".
   * Receives the restored solar schedule temperature.
   */
  onResetToSolar?: (solarKelvin: number) => void;
  /**
   * Current solar schedule temperature in Kelvin.
   * If omitted, calculated dynamically from the current time of day via getScheduleKelvin.
   */
  solarKelvin?: number;
  /**
   * Step increment for slider adjustment (default: 50).
   */
  step?: number;
  /**
   * Whether the slider control is disabled.
   */
  disabled?: boolean;
  /**
   * Additional CSS class names.
   */
  className?: string;
  /**
   * Test identifier.
   */
  "data-testid"?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getCurrentSolarMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Returns a CSS rgb string for a given Kelvin temperature.
 */
function kelvinToCss(kelvin: number): string {
  const { r, g, b } = kelvinToRgb(kelvin);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Generates the linear color-temperature spectrum gradient spanning from 2700K to 6500K.
 */
const KELVIN_SPECTRUM_GRADIENT = `linear-gradient(to right, ${[
  2700, 3200, 3800, 4500, 5200, 5800, 6500,
]
  .map((k) => {
    const percent = ((k - 2700) / (6500 - 2700)) * 100;
    return `${kelvinToCss(k)} ${percent.toFixed(1)}%`;
  })
  .join(", ")})`;

export function CircadianSliderControl({
  value: controlledValue,
  defaultValue,
  onChange,
  isManualOverride: controlledIsManualOverride,
  defaultManualOverride = false,
  onManualOverrideChange,
  onResetToSolar,
  solarKelvin: propSolarKelvin,
  step = 50,
  disabled = false,
  className,
  "data-testid": testId = "circadian-slider-control",
}: CircadianSliderControlProps) {
  const sliderId = useId();

  // Resolve current solar schedule temperature
  const calculatedSolarKelvin = useMemo(() => {
    if (typeof propSolarKelvin === "number" && Number.isFinite(propSolarKelvin)) {
      return clamp(propSolarKelvin, MIN_KELVIN, MAX_KELVIN);
    }
    return getScheduleKelvin(getCurrentSolarMinutes());
  }, [propSolarKelvin]);

  // Uncontrolled state for temperature
  const [internalValue, setInternalValue] = useState<number>(() => {
    if (typeof defaultValue === "number" && Number.isFinite(defaultValue)) {
      return clamp(defaultValue, MIN_KELVIN, MAX_KELVIN);
    }
    return calculatedSolarKelvin;
  });

  // Uncontrolled state for manual override
  const [internalOverride, setInternalOverride] = useState<boolean>(defaultManualOverride);

  const isControlledValue = controlledValue !== undefined;
  const isControlledOverride = controlledIsManualOverride !== undefined;

  const currentKelvin = isControlledValue
    ? clamp(controlledValue, MIN_KELVIN, MAX_KELVIN)
    : internalValue;

  const isOverrideActive = isControlledOverride
    ? controlledIsManualOverride
    : internalOverride;

  // Handle slider interaction
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = Number(e.target.value);
      const nextKelvin = clamp(raw, MIN_KELVIN, MAX_KELVIN);

      if (!isControlledValue) {
        setInternalValue(nextKelvin);
      }
      onChange?.(nextKelvin);

      // Activate manual override if not already active
      if (!isOverrideActive) {
        if (!isControlledOverride) {
          setInternalOverride(true);
        }
        onManualOverrideChange?.(true);
      }
    },
    [
      isControlledValue,
      onChange,
      isOverrideActive,
      isControlledOverride,
      onManualOverrideChange,
    ],
  );

  // Handle reset to solar schedule
  const handleResetToSolar = useCallback(() => {
    const targetSolar = calculatedSolarKelvin;

    if (!isControlledValue) {
      setInternalValue(targetSolar);
    }
    onChange?.(targetSolar);

    if (!isControlledOverride) {
      setInternalOverride(false);
    }
    onManualOverrideChange?.(false);
    onResetToSolar?.(targetSolar);
  }, [
    calculatedSolarKelvin,
    isControlledValue,
    onChange,
    isControlledOverride,
    onManualOverrideChange,
    onResetToSolar,
  ]);

  const swatchColor = useMemo(() => kelvinToCss(currentKelvin), [currentKelvin]);

  // Semantic warmth description
  const warmthLabel = useMemo(() => {
    if (currentKelvin <= 3200) return "Warm Sunset";
    if (currentKelvin <= 4200) return "Soft Warmth";
    if (currentKelvin <= 5400) return "Neutral Focus";
    return "Cool Daylight";
  }, [currentKelvin]);

  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100",
        className,
      )}
    >
      {/* Header and Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl shadow-inner border border-black/5 dark:border-white/10 transition-colors"
            style={{ backgroundColor: swatchColor }}
            aria-hidden="true"
          >
            <Sun className="h-5 w-5 text-zinc-900/80 drop-shadow-sm" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">
              Circadian Color Temperature
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {warmthLabel} ({currentKelvin}K)
            </p>
          </div>
        </div>

        {/* Status Indicators & Reset Action */}
        <div className="flex items-center gap-2">
          {isOverrideActive ? (
            <>
              <span
                data-testid="manual-override-badge"
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400"
              >
                <Sliders className="h-3 w-3" aria-hidden="true" />
                <span>Manual Override</span>
              </span>

              <button
                type="button"
                data-testid="reset-solar-button"
                onClick={handleResetToSolar}
                disabled={disabled}
                aria-label="Reset to Solar Schedule"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-750 dark:hover:text-zinc-100 transition-colors"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Reset to Solar Schedule</span>
              </button>
            </>
          ) : (
            <span
              data-testid="solar-schedule-badge"
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
            >
              <Sun className="h-3 w-3" aria-hidden="true" />
              <span>Solar Schedule Active</span>
            </span>
          )}
        </div>
      </div>

      {/* Visual Gradient Track Preview */}
      <div className="space-y-2 mb-2">
        <div
          data-testid="kelvin-gradient-track"
          aria-hidden="true"
          className="h-3.5 w-full rounded-full shadow-inner border border-black/5 dark:border-white/5"
          style={{ backgroundImage: KELVIN_SPECTRUM_GRADIENT }}
        />

        {/* Range Slider */}
        <div className="relative">
          <input
            id={sliderId}
            type="range"
            data-testid="circadian-temperature-slider"
            aria-label="Circadian color temperature slider"
            aria-valuemin={MIN_KELVIN}
            aria-valuemax={MAX_KELVIN}
            aria-valuenow={currentKelvin}
            aria-valuetext={`${currentKelvin}K, ${warmthLabel}`}
            min={MIN_KELVIN}
            max={MAX_KELVIN}
            step={step}
            value={currentKelvin}
            disabled={disabled}
            onChange={handleSliderChange}
            className="w-full cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Spectrum Extremity Labels */}
        <div
          className="flex items-center justify-between font-mono text-xs text-zinc-500 dark:text-zinc-400"
          aria-hidden="true"
        >
          <span className="flex flex-col">
            <span className="font-semibold">{MIN_KELVIN}K</span>
            <span className="text-[10px]">Warm Sunset</span>
          </span>

          <span className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
            {currentKelvin}K
          </span>

          <span className="flex flex-col items-end">
            <span className="font-semibold">{MAX_KELVIN}K</span>
            <span className="text-[10px]">Cool Daylight</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default CircadianSliderControl;
