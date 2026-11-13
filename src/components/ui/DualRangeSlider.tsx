"use client";

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useId,
} from "react";
import { cn } from "@/lib/utils";

export interface DualRangeSliderProps {
  /** Minimum slider bound. Default: 0 */
  min?: number;
  /** Maximum slider bound. Default: 100 */
  max?: number;
  /** Step increment for fine-tuning. Default: 1 */
  step?: number;
  /** Controlled value tuple [min, max] */
  value?: [number, number];
  /** Default uncontrolled value tuple [min, max] */
  defaultValue?: [number, number];
  /** Callback fired whenever the range changes */
  onChange?: (value: [number, number]) => void;
  /** Callback fired when user releases the thumb */
  onChangeEnd?: (value: [number, number]) => void;
  /** Minimum distance required between min and max thumbs */
  minDistance?: number;
  /** Value formatting function for accessible aria-valuetext and tooltips */
  formatValue?: (val: number) => string;
  /** Accessible label for the minimum thumb */
  minThumbLabel?: string;
  /** Accessible label for the maximum thumb */
  maxThumbLabel?: string;
  /** Visual header label for the slider component */
  label?: string;
  /** Whether the slider is disabled */
  disabled?: boolean;
  /** Additional CSS class names */
  className?: string;
  /** Test identifier */
  "data-testid"?: string;
  /** Whether to render floating tooltips above active thumbs */
  showTooltips?: boolean;
}

export function DualRangeSlider({
  min = 0,
  max = 100,
  step = 1,
  value: controlledValue,
  defaultValue = [min, max],
  onChange,
  onChangeEnd,
  minDistance = 0,
  formatValue = (v: number) => String(v),
  minThumbLabel = "Minimum value",
  maxThumbLabel = "Maximum value",
  label,
  disabled = false,
  className = "",
  "data-testid": testId = "dual-range-slider",
  showTooltips = true,
}: DualRangeSliderProps) {
  const generatedId = useId();
  const trackRef = useRef<HTMLDivElement>(null);

  // Uncontrolled state fallback
  const [internalValue, setInternalValue] = useState<[number, number]>(() => {
    const initial = controlledValue ?? defaultValue;
    const clampedMin = Math.max(min, Math.min(initial[0], max - minDistance));
    const clampedMax = Math.min(max, Math.max(initial[1], clampedMin + minDistance));
    return [clampedMin, clampedMax];
  });

  const isControlled = controlledValue !== undefined;
  const rawValues = isControlled ? controlledValue : internalValue;

  // Ensure values stay valid, sorted, and properly clamped
  const currentMin = Math.max(min, Math.min(rawValues[0], max - minDistance));
  const currentMax = Math.min(max, Math.max(rawValues[1], currentMin + minDistance));
  const currentValues: [number, number] = [currentMin, currentMax];

  const [activeThumb, setActiveThumb] = useState<"min" | "max" | null>(null);
  const [focusedThumb, setFocusedThumb] = useState<"min" | "max" | null>(null);

  // Sync internal value if controlledValue updates
  useEffect(() => {
    if (controlledValue) {
      setInternalValue(controlledValue);
    }
  }, [controlledValue]);

  // Compute percentage coordinates for track highlight and thumbs
  const rangeSpan = Math.max(0.0001, max - min);
  const minPercent = Math.max(0, Math.min(100, ((currentMin - min) / rangeSpan) * 100));
  const maxPercent = Math.max(0, Math.min(100, ((currentMax - min) / rangeSpan) * 100));

  const updateValues = useCallback(
    (newMin: number, newMax: number, isFinal: boolean = false) => {
      if (disabled) return;

      // Clamp and enforce minDistance
      const clampedMin = Math.max(min, Math.min(newMin, max - minDistance));
      const clampedMax = Math.min(max, Math.max(newMax, clampedMin + minDistance));
      const nextValues: [number, number] = [clampedMin, clampedMax];

      if (!isControlled) {
        setInternalValue(nextValues);
      }

      onChange?.(nextValues);
      if (isFinal) {
        onChangeEnd?.(nextValues);
      }
    },
    [disabled, min, max, minDistance, isControlled, onChange, onChangeEnd],
  );

  // Calculate stepped value from pixel position along track
  const getValueFromPointer = useCallback(
    (clientX: number): number => {
      if (!trackRef.current) return min;
      const rect = trackRef.current.getBoundingClientRect();
      const width = rect.width;
      if (width <= 0) return min;

      const offset = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, offset / width));
      const rawValue = min + ratio * (max - min);

      // Quantize to step increments
      const stepped = Math.round((rawValue - min) / step) * step + min;
      // Precision rounding to avoid floating-point drift (e.g. 0.300000000004)
      const precision = step.toString().split(".")[1]?.length || 0;
      return Number(Math.max(min, Math.min(max, stepped)).toFixed(precision));
    },
    [min, max, step],
  );

  // -------------------------------------------------------------------------
  // Pointer & Touch Interaction Handlers
  // -------------------------------------------------------------------------

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const clickValue = getValueFromPointer(e.clientX);

    // Determine which thumb is closer to the interaction coordinate
    const distToMin = Math.abs(clickValue - currentMin);
    const distToMax = Math.abs(clickValue - currentMax);
    const chosenThumb: "min" | "max" =
      distToMin < distToMax
        ? "min"
        : distToMin > distToMax
          ? "max"
          : clickValue < currentMin
            ? "min"
            : "max";

    setActiveThumb(chosenThumb);
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (chosenThumb === "min") {
      updateValues(Math.min(clickValue, currentMax - minDistance), currentMax);
    } else {
      updateValues(currentMin, Math.max(clickValue, currentMin + minDistance));
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeThumb || disabled) return;
    const pointerValue = getValueFromPointer(e.clientX);

    if (activeThumb === "min") {
      updateValues(Math.min(pointerValue, currentMax - minDistance), currentMax);
    } else {
      updateValues(currentMin, Math.max(pointerValue, currentMin + minDistance));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeThumb) return;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {}
    setActiveThumb(null);
    onChangeEnd?.(currentValues);
  };

  // Explicit touch handling for mobile devices
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!activeThumb || disabled || !e.touches[0]) return;
    const touchValue = getValueFromPointer(e.touches[0].clientX);

    if (activeThumb === "min") {
      updateValues(Math.min(touchValue, currentMax - minDistance), currentMax);
    } else {
      updateValues(currentMin, Math.max(touchValue, currentMin + minDistance));
    }
  };

  const handleTouchEnd = () => {
    if (activeThumb) {
      setActiveThumb(null);
      onChangeEnd?.(currentValues);
    }
  };

  // -------------------------------------------------------------------------
  // Keyboard Fine-Tuning: Arrow (step 1), PageUp / PageDown (step 10)
  // -------------------------------------------------------------------------

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    thumb: "min" | "max",
  ) => {
    if (disabled) return;

    let delta = 0;
    const fineStep = step;
    const coarseStep = step * 10; // PageUp / PageDown step: 10 (or 10x step)

    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        delta = -fineStep;
        break;
      case "ArrowRight":
      case "ArrowUp":
        delta = fineStep;
        break;
      case "PageDown":
        delta = -coarseStep;
        break;
      case "PageUp":
        delta = coarseStep;
        break;
      case "Home":
        if (thumb === "min") {
          updateValues(min, currentMax, true);
        } else {
          updateValues(currentMin, currentMin + minDistance, true);
        }
        e.preventDefault();
        return;
      case "End":
        if (thumb === "min") {
          updateValues(currentMax - minDistance, currentMax, true);
        } else {
          updateValues(currentMin, max, true);
        }
        e.preventDefault();
        return;
      default:
        return;
    }

    e.preventDefault();

    if (thumb === "min") {
      const nextMin = Math.min(currentMax - minDistance, currentMin + delta);
      updateValues(nextMin, currentMax, true);
    } else {
      const nextMax = Math.max(currentMin + minDistance, currentMax + delta);
      updateValues(currentMin, nextMax, true);
    }
  };

  return (
    <div
      data-testid={testId}
      className={cn("w-full select-none py-2", disabled && "opacity-50 cursor-not-allowed", className)}
    >
      {/* Header Label & Live Readouts */}
      {label && (
        <div className="flex items-center justify-between text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          <label id={`${generatedId}-label`} className="font-semibold">
            {label}
          </label>
          <span className="font-mono text-zinc-500 dark:text-zinc-400">
            {formatValue(currentMin)} – {formatValue(currentMax)}
          </span>
        </div>
      )}

      {/* Main Slider Track Viewport */}
      <div
        ref={trackRef}
        data-testid="dual-range-track-container"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className={cn(
          "relative flex items-center h-8 w-full cursor-pointer touch-none",
          disabled && "cursor-not-allowed",
        )}
      >
        {/* Inactive Rail Background */}
        <div
          data-testid="dual-range-rail"
          className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 transition-colors"
        />

        {/* Active Highlight Track between Min and Max Coordinates */}
        <div
          data-testid="dual-range-track-highlight"
          className="absolute h-2 rounded-full bg-blue-600 dark:bg-blue-500 transition-[background-color]"
          style={{
            left: `${minPercent}%`,
            width: `${Math.max(0, maxPercent - minPercent)}%`,
          }}
        />

        {/* Minimum Value Thumb */}
        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={minThumbLabel}
          aria-labelledby={label ? `${generatedId}-label` : undefined}
          aria-valuemin={min}
          aria-valuemax={currentMax - minDistance}
          aria-valuenow={currentMin}
          aria-valuetext={formatValue(currentMin)}
          data-testid="dual-range-thumb-min"
          onKeyDown={(e) => handleKeyDown(e, "min")}
          onFocus={() => setFocusedThumb("min")}
          onBlur={() => setFocusedThumb(null)}
          style={{ left: `${minPercent}%` }}
          className={cn(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
            "h-5 w-5 rounded-full border-2 border-blue-600 bg-white dark:bg-zinc-900 shadow-md",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
            "transition-transform active:scale-110",
            activeThumb === "min" && "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-zinc-900 scale-110",
            disabled ? "pointer-events-none" : "hover:scale-105",
          )}
        >
          {showTooltips && (activeThumb === "min" || focusedThumb === "min") && (
            <div
              data-testid="dual-range-tooltip-min"
              className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 dark:bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono font-medium text-white dark:text-zinc-900 shadow pointer-events-none"
            >
              {formatValue(currentMin)}
            </div>
          )}
        </div>

        {/* Maximum Value Thumb */}
        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={maxThumbLabel}
          aria-labelledby={label ? `${generatedId}-label` : undefined}
          aria-valuemin={currentMin + minDistance}
          aria-valuemax={max}
          aria-valuenow={currentMax}
          aria-valuetext={formatValue(currentMax)}
          data-testid="dual-range-thumb-max"
          onKeyDown={(e) => handleKeyDown(e, "max")}
          onFocus={() => setFocusedThumb("max")}
          onBlur={() => setFocusedThumb(null)}
          style={{ left: `${maxPercent}%` }}
          className={cn(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
            "h-5 w-5 rounded-full border-2 border-blue-600 bg-white dark:bg-zinc-900 shadow-md",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
            "transition-transform active:scale-110",
            activeThumb === "max" && "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-zinc-900 scale-110",
            disabled ? "pointer-events-none" : "hover:scale-105",
          )}
        >
          {showTooltips && (activeThumb === "max" || focusedThumb === "max") && (
            <div
              data-testid="dual-range-tooltip-max"
              className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 dark:bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono font-medium text-white dark:text-zinc-900 shadow pointer-events-none"
            >
              {formatValue(currentMax)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DualRangeSlider;
