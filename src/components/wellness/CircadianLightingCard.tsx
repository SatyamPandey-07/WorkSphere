"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Lightbulb, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

export const MIN_KELVIN = 2700;
export const MAX_KELVIN = 6500;
export const MINUTES_PER_DAY = 1440;
/** Manual overrides fall back to the system schedule after 60 minutes. */
export const OVERRIDE_DURATION_MS = 60 * 60 * 1000;
export const OVERRIDE_STORAGE_KEY = "worksphere:circadian-override";

export interface CircadianOverride {
  /** Color temperature held while the override is active. */
  kelvin: number;
  startedAt: number;
  /** Epoch ms at which the override expires and the system schedule resumes. */
  expiresAt: number;
}

export type CircadianOverrideReason =
  "enabled" | "updated" | "cleared" | "expired" | "restored";

export interface CircadianLightingCardProps {
  /** Fired whenever the override starts, changes, is cleared, expires or is restored. */
  onOverrideChange?: (
    override: CircadianOverride | null,
    reason: CircadianOverrideReason,
  ) => void;
  /** Fired whenever the preview slider moves. */
  onPreviewChange?: (preview: { minutes: number; kelvin: number }) => void;
  /** Override length in milliseconds (default: 60 minutes). */
  overrideDurationMs?: number;
  /** localStorage key used to persist the override (default: OVERRIDE_STORAGE_KEY). */
  storageKey?: string;
  className?: string;
  "data-testid"?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Convert a pointer position on the slider track into its bounded value. */
export function getSliderValueFromClientX(
  clientX: number,
  rect: Pick<DOMRect, "left" | "width">,
  min = 0,
  max = MINUTES_PER_DAY - 1,
): number {
  const width = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 1;
  const position = clamp((clientX - rect.left) / width, 0, 1);
  return Math.round(min + position * (max - min));
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * System schedule: warm (2700K) overnight, ramping to daylight (6500K) through
 * the morning, holding through the afternoon, then easing back to warm in the evening.
 * Accepts any number of minutes and wraps it into a 24 hour day.
 */
export function getScheduleKelvin(minutesOfDay: number): number {
  const minutes = Number.isFinite(minutesOfDay) ? minutesOfDay : 0;
  const hour =
    (((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 60;

  let factor: number;
  if (hour <= 6 || hour >= 21) {
    factor = 0;
  } else if (hour < 9.5) {
    factor = smoothstep((hour - 6) / 3.5);
  } else if (hour <= 17) {
    factor = 1;
  } else {
    factor = smoothstep(1 - (hour - 17) / 4);
  }

  return Math.round(MIN_KELVIN + factor * (MAX_KELVIN - MIN_KELVIN));
}

/** Approximates the display color of a black body at the given temperature. */
export function kelvinToRgb(kelvin: number): {
  r: number;
  g: number;
  b: number;
} {
  const t =
    clamp(Number.isFinite(kelvin) ? kelvin : MAX_KELVIN, 1000, 40000) / 100;

  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b =
    t >= 66
      ? 255
      : t <= 19
        ? 0
        : 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return {
    r: Math.round(clamp(r, 0, 255)),
    g: Math.round(clamp(g, 0, 255)),
    b: Math.round(clamp(b, 0, 255)),
  };
}

function kelvinToCss(kelvin: number): string {
  const { r, g, b } = kelvinToRgb(kelvin);
  return `rgb(${r}, ${g}, ${b})`;
}

/** 0 to 1439 minutes to "HH:MM". */
export function formatTimeOfDay(minutesOfDay: number): string {
  const total = clamp(
    Math.round(Number.isFinite(minutesOfDay) ? minutesOfDay : 0),
    0,
    MINUTES_PER_DAY - 1,
  );
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** Milliseconds to "MM:SS" (rounded up so the timer never shows 00:00 while time remains). */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(
    0,
    Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function minutesOfDayFromMs(ms: number): number {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
}

const DAY_GRADIENT = `linear-gradient(to right, ${Array.from(
  { length: 25 },
  (_, hour) => {
    return `${kelvinToCss(getScheduleKelvin(hour * 60))} ${(hour / 24) * 100}%`;
  },
).join(", ")})`;

function isValidOverride(value: unknown): value is CircadianOverride {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kelvin === "number" &&
    Number.isFinite(candidate.kelvin) &&
    candidate.kelvin >= MIN_KELVIN &&
    candidate.kelvin <= MAX_KELVIN &&
    typeof candidate.startedAt === "number" &&
    Number.isFinite(candidate.startedAt) &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt)
  );
}

function readStoredOverride(storageKey: string): CircadianOverride | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidOverride(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredOverride(
  storageKey: string,
  override: CircadianOverride | null,
): void {
  try {
    if (override) {
      window.localStorage.setItem(storageKey, JSON.stringify(override));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Storage can be unavailable (private mode, quota). The override still works for this session.
  }
}

/**
 * CircadianLightingCard: scrub through a 24 hour day to preview the circadian
 * color temperature (2700K to 6500K), and hold a manual override that falls
 * back to the system schedule after 60 minutes.
 */
export function CircadianLightingCard({
  onOverrideChange,
  onPreviewChange,
  overrideDurationMs = OVERRIDE_DURATION_MS,
  storageKey = OVERRIDE_STORAGE_KEY,
  className,
  "data-testid": dataTestId = "circadian-lighting-card",
}: CircadianLightingCardProps) {
  // Time is read after mount so server and client markup match (timezones differ).
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [previewMinutes, setPreviewMinutes] = useState<number | null>(null);
  const [override, setOverride] = useState<CircadianOverride | null>(null);
  const ready = nowMs !== null && previewMinutes !== null;
  const sliderRef = useRef<HTMLInputElement>(null);
  const pointerDraggingRef = useRef(false);

  const overrideRef = useRef<CircadianOverride | null>(null);
  const onOverrideChangeRef = useRef(onOverrideChange);
  const onPreviewChangeRef = useRef(onPreviewChange);

  useEffect(() => {
    onOverrideChangeRef.current = onOverrideChange;
    onPreviewChangeRef.current = onPreviewChange;
  });

  const commitOverride = useCallback(
    (next: CircadianOverride | null, reason: CircadianOverrideReason) => {
      overrideRef.current = next;
      setOverride(next);
      writeStoredOverride(storageKey, next);
      onOverrideChangeRef.current?.(next, reason);
    },
    [storageKey],
  );

  // Initialise the clock, restore a saved override, then tick once per second.
  useEffect(() => {
    const start = Date.now();

    const stored = readStoredOverride(storageKey);
    let initialOverride: CircadianOverride | null = null;
    if (stored) {
      if (stored.expiresAt > start) {
        initialOverride = stored;
      } else {
        writeStoredOverride(storageKey, null);
      }
    }

    const initTimer = setTimeout(() => {
      setNowMs(start);
      setPreviewMinutes((current) => current ?? minutesOfDayFromMs(start));
      if (initialOverride) {
        overrideRef.current = initialOverride;
        setOverride(initialOverride);
        onOverrideChangeRef.current?.(initialOverride, "restored");
      } else if (stored) {
        onOverrideChangeRef.current?.(null, "expired");
      }
    }, 0);

    const interval = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      const active = overrideRef.current;
      if (active && now >= active.expiresAt) {
        commitOverride(null, "expired");
      }
    }, 1000);

    return () => {
      clearTimeout(initTimer);
      clearInterval(interval);
    };
  }, [storageKey, commitOverride]);

  // Expire exactly on time (the 1s ticker above is only a backstop, e.g. after the tab slept).
  const expiresAt = override?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const timer = setTimeout(
      () => {
        if (overrideRef.current?.expiresAt === expiresAt) {
          commitOverride(null, "expired");
        }
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, commitOverride]);

  const handleSliderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const minutes = clamp(
        Math.round(Number(event.target.value)),
        0,
        MINUTES_PER_DAY - 1,
      );
      const kelvin = getScheduleKelvin(minutes);
      setPreviewMinutes(minutes);
      onPreviewChangeRef.current?.({ minutes, kelvin });

      const active = overrideRef.current;
      if (active) {
        commitOverride({ ...active, kelvin }, "updated");
      }
    },
    [commitOverride],
  );

  const updateSliderFromPointer = useCallback(
    (clientX: number) => {
      const slider = sliderRef.current;
      if (!slider || !Number.isFinite(clientX)) return;
      handleSliderChange({
        target: {
          value: String(
            getSliderValueFromClientX(clientX, slider.getBoundingClientRect()),
          ),
        },
      } as React.ChangeEvent<HTMLInputElement>);
    },
    [handleSliderChange],
  );

  const handleSliderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLInputElement>) => {
      if (!ready) return;
      pointerDraggingRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      updateSliderFromPointer(event.clientX);
    },
    [ready, updateSliderFromPointer],
  );

  const handleSliderPointerMove = useCallback(
    (event: React.PointerEvent<HTMLInputElement>) => {
      if (!pointerDraggingRef.current) return;
      event.preventDefault();
      updateSliderFromPointer(event.clientX);
    },
    [updateSliderFromPointer],
  );

  const handleSliderPointerEnd = useCallback(
    (event: React.PointerEvent<HTMLInputElement>) => {
      if (!pointerDraggingRef.current) return;
      pointerDraggingRef.current = false;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    [],
  );

  const handleToggle = useCallback(() => {
    if (overrideRef.current) {
      commitOverride(null, "cleared");
      return;
    }
    const startedAt = Date.now();
    const minutes = previewMinutes ?? minutesOfDayFromMs(startedAt);
    setNowMs(startedAt);
    commitOverride(
      {
        kelvin: getScheduleKelvin(minutes),
        startedAt,
        expiresAt: startedAt + overrideDurationMs,
      },
      "enabled",
    );
  }, [commitOverride, overrideDurationMs, previewMinutes]);

  const systemKelvin = ready
    ? getScheduleKelvin(minutesOfDayFromMs(nowMs))
    : MAX_KELVIN;
  const appliedKelvin = override ? override.kelvin : systemKelvin;
  const previewKelvin = ready ? getScheduleKelvin(previewMinutes) : MAX_KELVIN;
  const remainingMs =
    override && nowMs !== null ? Math.max(0, override.expiresAt - nowMs) : 0;
  const sliderValue = previewMinutes ?? 0;

  const previewGradient = ready
    ? `linear-gradient(135deg, ${kelvinToCss(getScheduleKelvin(previewMinutes - 60))} 0%, ${kelvinToCss(
        previewKelvin,
      )} 50%, ${kelvinToCss(getScheduleKelvin(previewMinutes + 60))} 100%)`
    : undefined;

  return (
    <section
      data-testid={dataTestId}
      aria-label="Circadian lighting"
      className={cn(
        "w-full max-w-md space-y-5 rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 sm:p-6",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-700"
            style={{ backgroundColor: kelvinToCss(appliedKelvin) }}
            aria-hidden="true"
          >
            <Lightbulb className="h-5 w-5 text-zinc-900" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Circadian lighting
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {override ? "Manual override" : "System schedule"}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p
            data-testid="circadian-applied-kelvin"
            className="font-mono text-xl font-semibold tabular-nums"
          >
            {ready ? `${appliedKelvin}K` : "--"}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Applied now
          </p>
        </div>
      </header>

      <div className="space-y-3">
        <div
          data-testid="circadian-preview-swatch"
          className="h-20 w-full rounded-xl border border-zinc-200 dark:border-zinc-700"
          style={{ backgroundImage: previewGradient }}
          role="img"
          aria-label={`Preview color at ${ready ? formatTimeOfDay(previewMinutes) : "--:--"}`}
        />
        <div className="flex items-baseline justify-between">
          <span
            data-testid="circadian-preview-time"
            className="font-mono text-sm tabular-nums"
          >
            {ready ? formatTimeOfDay(previewMinutes) : "--:--"}
          </span>
          <span
            data-testid="circadian-preview-kelvin"
            className="font-mono text-sm font-semibold tabular-nums"
          >
            {ready ? `${previewKelvin}K` : "--"}
          </span>
        </div>

        <div className="space-y-1">
          <div
            className="h-2 w-full rounded-full"
            style={{ backgroundImage: DAY_GRADIENT }}
            aria-hidden="true"
          />
          <input
            type="range"
            ref={sliderRef}
            data-testid="circadian-preview-slider"
            aria-label="Preview time of day"
            aria-valuetext={
              ready
                ? `${formatTimeOfDay(previewMinutes)}, ${previewKelvin}K`
                : undefined
            }
            min={0}
            max={MINUTES_PER_DAY - 1}
            step={1}
            value={sliderValue}
            disabled={!ready}
            onChange={handleSliderChange}
            onPointerDown={handleSliderPointerDown}
            onPointerMove={handleSliderPointerMove}
            onPointerUp={handleSliderPointerEnd}
            onPointerCancel={handleSliderPointerEnd}
            style={{ touchAction: "none" }}
            className="w-full cursor-pointer accent-amber-500 disabled:cursor-not-allowed"
          />
          <div
            className="flex justify-between font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
            aria-hidden="true"
          >
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="space-y-0.5">
          <p id="circadian-override-label" className="text-sm font-medium">
            Manual override
          </p>
          {override ? (
            <p
              data-testid="circadian-override-remaining"
              role="timer"
              aria-live="off"
              className="flex items-center gap-1 font-mono text-xs tabular-nums text-amber-600 dark:text-amber-400"
            >
              <Timer className="h-3.5 w-3.5" aria-hidden="true" />
              Ends in {formatRemaining(remainingMs)}
            </p>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Holds the previewed color for 60 minutes
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={override !== null}
          aria-labelledby="circadian-override-label"
          data-testid="circadian-override-toggle"
          disabled={!ready}
          onClick={handleToggle}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-zinc-900",
            override
              ? "border-amber-500 bg-amber-500"
              : "border-zinc-300 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-700",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              override ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
    </section>
  );
}

export default CircadianLightingCard;
