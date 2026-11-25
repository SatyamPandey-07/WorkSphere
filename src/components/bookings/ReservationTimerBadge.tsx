'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';

export const HOLD_DURATION_SECONDS = 10 * 60; // 600 seconds
export const DEFAULT_RING_RADIUS = 10;
export const DEFAULT_STROKE_WIDTH = 2.5;
export const DEFAULT_BADGE_SIZE = 24;

export type TimerRingColor = 'green' | 'yellow' | 'red';

/**
 * Calculates progress fraction [0, 1] for remaining hold time.
 * Clamps values below 0 to 0, and values above total to 1.
 */
export function calculateProgress(
  remainingSeconds: number,
  totalDurationSeconds: number = HOLD_DURATION_SECONDS,
): number {
  if (totalDurationSeconds <= 0) return 0;
  return Math.max(0, Math.min(1, remainingSeconds / totalDurationSeconds));
}

/**
 * Calculates the circumference of a circle given its radius.
 */
export function calculateCircumference(radius: number): number {
  return 2 * Math.PI * radius;
}

/**
 * Calculates SVG stroke-dashoffset for the countdown ring progress arc.
 * At progress 1.0 (full time), offset is 0 (full ring).
 * At progress 0.0 (expired), offset equals circumference (empty ring).
 */
export function calculateStrokeDashoffset(
  progress: number,
  circumference: number,
): number {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  return circumference * (1 - clampedProgress);
}

/**
 * Maps remaining seconds to exact color thresholds:
 * - More than 5 minutes (> 300s): Green
 * - 2 to 5 minutes, inclusive (120s <= remaining <= 300s): Yellow
 * - Less than 2 minutes (< 120s): Red
 */
export function getTimerRingColor(remainingSeconds: number): TimerRingColor {
  if (remainingSeconds > 300) {
    return 'green';
  }
  if (remainingSeconds >= 120) {
    return 'yellow';
  }
  return 'red';
}

/**
 * Formats seconds into MM:SS format with zero-padding.
 * Negative values are clamped to 00:00.
 */
export function formatRemainingTime(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const TIMER_COLOR_CONFIG: Record<
  TimerRingColor,
  {
    ringColor: string;
    textClass: string;
    bgClass: string;
    borderClass: string;
    pulseClass: string;
  }
> = {
  green: {
    ringColor: '#10b981', // emerald-500
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    pulseClass: '',
  },
  yellow: {
    ringColor: '#f59e0b', // amber-500
    textClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
    pulseClass: '',
  },
  red: {
    ringColor: '#ef4444', // red-500
    textClass: 'text-red-400',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
    pulseClass: 'animate-pulse motion-reduce:animate-none',
  },
};

export interface ReservationTimerBadgeProps {
  /** Optional controlled remaining seconds. If provided, disables internal interval. */
  remainingSeconds?: number;
  /** Server-provided or initial expiration timestamp in epoch milliseconds. */
  initialExpiresAt?: number;
  /** Total hold duration in seconds. Defaults to 600 (10 minutes). */
  totalDurationSeconds?: number;
  /** Callback fired when hold time reaches zero. */
  onExpire?: () => void;
  /** Optional custom container CSS class. */
  className?: string;
  /** Optional SVG ring radius. Defaults to 10. */
  radius?: number;
  /** Optional SVG stroke width. Defaults to 2.5. */
  strokeWidth?: number;
  /** Optional SVG view box size. Defaults to 24. */
  size?: number;
  /** Text label preceding the numeric countdown. Defaults to 'Hold: '. */
  label?: string;
}

export function ReservationTimerBadge({
  remainingSeconds: controlledRemainingSeconds,
  initialExpiresAt,
  totalDurationSeconds = HOLD_DURATION_SECONDS,
  onExpire,
  className = '',
  radius = DEFAULT_RING_RADIUS,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  size = DEFAULT_BADGE_SIZE,
  label = 'Hold: ',
}: ReservationTimerBadgeProps) {
  const isControlled = controlledRemainingSeconds !== undefined;

  // Stable expiration target timestamp that does not reset on rerenders
  const expiresAtRef = useRef<number | null>(null);
  if (expiresAtRef.current === null && !isControlled) {
    expiresAtRef.current =
      initialExpiresAt ?? Date.now() + totalDurationSeconds * 1000;
  }

  // Internal state for uncontrolled / autonomous countdown
  const [internalSeconds, setInternalSeconds] = useState<number>(() => {
    if (isControlled) return controlledRemainingSeconds;
    if (expiresAtRef.current) {
      return Math.max(0, Math.ceil((expiresAtRef.current - Date.now()) / 1000));
    }
    return totalDurationSeconds;
  });

  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  // Keep internal state updated if initialExpiresAt prop changes externally
  useEffect(() => {
    if (initialExpiresAt && !isControlled) {
      expiresAtRef.current = initialExpiresAt;
      const rem = Math.max(0, Math.ceil((initialExpiresAt - Date.now()) / 1000));
      setInternalSeconds(rem);
    }
  }, [initialExpiresAt, isControlled]);

  // Fire expiration callback in controlled mode if remaining reaches zero
  useEffect(() => {
    if (
      isControlled &&
      controlledRemainingSeconds !== undefined &&
      controlledRemainingSeconds <= 0
    ) {
      onExpireRef.current?.();
    }
  }, [isControlled, controlledRemainingSeconds]);

  // Interval timer for uncontrolled countdown
  useEffect(() => {
    if (isControlled) return;

    const tick = () => {
      if (!expiresAtRef.current) return;
      const now = Date.now();
      const rem = Math.max(0, Math.ceil((expiresAtRef.current - now) / 1000));
      setInternalSeconds(rem);
      if (rem <= 0) {
        onExpireRef.current?.();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isControlled]);

  const currentSeconds = isControlled
    ? controlledRemainingSeconds
    : internalSeconds;

  // Ring calculations
  const progress = useMemo(
    () => calculateProgress(currentSeconds, totalDurationSeconds),
    [currentSeconds, totalDurationSeconds],
  );

  const circumference = useMemo(() => calculateCircumference(radius), [radius]);
  const strokeDashoffset = useMemo(
    () => calculateStrokeDashoffset(progress, circumference),
    [progress, circumference],
  );

  const color = getTimerRingColor(currentSeconds);
  const colorConfig = TIMER_COLOR_CONFIG[color];
  const formattedTime = formatRemainingTime(currentSeconds);

  const center = size / 2;
  const isExpiringSoon = currentSeconds < 120;
  const isExpired = currentSeconds <= 0;

  const accessibleLabel = isExpired
    ? 'Seat reservation hold has expired'
    : isExpiringSoon
      ? `Seat reservation hold expires soon: ${formattedTime} remaining`
      : `Seat reservation hold: ${formattedTime} remaining`;

  return (
    <div
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={accessibleLabel}
      data-testid="reservation-timer-badge"
      data-color={color}
      data-pulsing={color === 'red'}
      data-remaining-seconds={currentSeconds}
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors select-none ${colorConfig.bgClass} ${colorConfig.borderClass} ${colorConfig.textClass} ${colorConfig.pulseClass} ${className}`}
    >
      {/* Animated SVG Progress Ring */}
      <div
        className="relative flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          role="presentation"
          aria-hidden="true"
          data-testid="reservation-timer-ring"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="overflow-visible"
        >
          {/* Background track ring */}
          <circle
            data-testid="timer-ring-track"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="opacity-20"
          />
          {/* Animated foreground progress arc */}
          <circle
            data-testid="timer-ring-progress"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={colorConfig.ringColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${center} ${center})`}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
          />
        </svg>
      </div>

      {/* Numeric Countdown Display */}
      <span
        data-testid="reservation-timer-text"
        className="font-mono tabular-nums font-semibold tracking-tight"
      >
        {label}
        {formattedTime}
      </span>
    </div>
  );
}

export default ReservationTimerBadge;
