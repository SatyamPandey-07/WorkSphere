"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export const DEFAULT_DECAY_FACTOR = 0.05;
export const AUDIO_DECAY_TIMEOUT_MS = 300;
export const PEAK_HOLD_DURATION_MS = 800;

/**
 * Linear interpolation (lerp) decay step function.
 * Smooths current level towards target level with given decay factor (~0.05 per frame).
 */
export function lerpDecay(
  currentLevel: number,
  targetLevel: number,
  decayFactor: number = DEFAULT_DECAY_FACTOR
): number {
  return currentLevel + (targetLevel - currentLevel) * decayFactor;
}

/**
 * Peak hold decay step function.
 * Lingers at peak for holdDurationMs (default 800ms) before descending smoothly.
 */
export function calculatePeakHold(
  currentPeak: number,
  newLevel: number,
  lastPeakTime: number,
  now: number,
  holdDurationMs: number = PEAK_HOLD_DURATION_MS,
  decayRate: number = 0.02
): { peak: number; peakTime: number } {
  if (newLevel >= currentPeak) {
    return { peak: newLevel, peakTime: now };
  }
  if (now - lastPeakTime < holdDurationMs) {
    return { peak: currentPeak, peakTime: lastPeakTime };
  }
  const decayedPeak = Math.max(newLevel, currentPeak - decayRate);
  return { peak: decayedPeak, peakTime: lastPeakTime };
}

type AudioLevelIndicatorProps = {
  /** Normalized audio level 0–1 */
  level: number;
  /** Diameter in px (default 80) */
  size?: number;
  /** Ring stroke width (default 3) */
  strokeWidth?: number;
  /** Show muted state */
  muted?: boolean;
  /** Decay factor for linear interpolation (default 0.05) */
  decayFactor?: number;
  /** Peak hold duration in ms before descending (default 800ms) */
  peakHoldDurationMs?: number;
  /** Show peak hold dot */
  showPeakHold?: boolean;
  /** Content to render inside the ring */
  children?: ReactNode;
};

/**
 * AudioLevelIndicator renders a circular audio volume meter around a child element.
 * Smoothly decays volume levels using requestAnimationFrame, linear interpolation (lerp),
 * and an 800ms peak-hold indicator dot.
 */
export function AudioLevelIndicator({
  level,
  size = 80,
  strokeWidth = 3,
  muted = false,
  decayFactor = DEFAULT_DECAY_FACTOR,
  peakHoldDurationMs = PEAK_HOLD_DURATION_MS,
  showPeakHold = true,
  children,
}: AudioLevelIndicatorProps): ReactNode {
  const initialClamped = Math.min(1, Math.max(0, muted ? 0 : Number.isFinite(level) ? level : 0));
  const [displayLevel, setDisplayLevel] = useState<number>(initialClamped);
  const [peakLevel, setPeakLevel] = useState<number>(initialClamped);

  const currentDisplayLevelRef = useRef<number>(initialClamped);
  const targetLevelRef = useRef<number>(initialClamped);
  const peakLevelRef = useRef<number>(initialClamped);
  const peakHoldTimeRef = useRef<number>(performance.now());
  const lastActiveTimeRef = useRef<number>(performance.now());
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const target = Math.min(1, Math.max(0, muted ? 0 : Number.isFinite(level) ? level : 0));
    targetLevelRef.current = target;
    const now = performance.now();

    if (target > 0) {
      lastActiveTimeRef.current = now;
    }

    // Fast attack on peak
    if (target >= peakLevelRef.current) {
      peakLevelRef.current = target;
      peakHoldTimeRef.current = now;
      setPeakLevel(target);
    }

    const animate = () => {
      const current = currentDisplayLevelRef.current;
      const targetLevel = targetLevelRef.current;
      const currentTime = performance.now();

      // 1. Level meter attack & decay
      if (targetLevel >= current) {
        // Fast attack: jump up immediately to catch speech transients
        currentDisplayLevelRef.current = targetLevel;
        setDisplayLevel(targetLevel);
        lastActiveTimeRef.current = currentTime;
      } else {
        // Smooth decay via linear interpolation (~0.05 per frame)
        let next = lerpDecay(current, targetLevel, decayFactor);

        // Fallback clamp: ensure level reaches 0 within 300ms when audio stops
        if (targetLevel === 0 && currentTime - lastActiveTimeRef.current >= AUDIO_DECAY_TIMEOUT_MS) {
          next = 0;
        } else if (Math.abs(next - targetLevel) < 0.005) {
          next = targetLevel;
        }

        currentDisplayLevelRef.current = next;
        setDisplayLevel(next);
      }

      // 2. Peak-hold decay: linger for 800ms before descending
      const curPeak = peakLevelRef.current;
      if (targetLevel >= curPeak) {
        peakLevelRef.current = targetLevel;
        peakHoldTimeRef.current = currentTime;
        setPeakLevel(targetLevel);
      } else if (currentTime - peakHoldTimeRef.current >= peakHoldDurationMs) {
        const decayedPeak = Math.max(targetLevel, curPeak - 0.02);
        peakLevelRef.current = decayedPeak;
        setPeakLevel(decayedPeak);
      }

      const levelNeedsUpdate = Math.abs(currentDisplayLevelRef.current - targetLevelRef.current) > 0.001;
      const peakNeedsUpdate = peakLevelRef.current > targetLevelRef.current;

      if (levelNeedsUpdate || peakNeedsUpdate) {
        rafIdRef.current = requestAnimationFrame(animate);
      }
    };

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [level, muted, decayFactor, peakHoldDurationMs]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Map 0–1 level to 0–circumference arc length (16% min visible ring)
  const clamped = Math.min(1, Math.max(0, muted ? 0 : displayLevel));
  const offset = circumference * (1 - Math.max(0.16, clamped));

  // Animated gradient hue for active audio
  const hue = muted ? 0 : 120 - clamped * 120; // green → red as volume increases
  const ringColor = muted
    ? "rgba(255,255,255,0.15)"
    : `hsla(${hue}, 80%, 55%, 0.9)`;

  // Peak hold coordinate along arc
  const clampedPeak = Math.min(1, Math.max(0, muted ? 0 : peakLevel));
  const peakAngle = -Math.PI / 2 + clampedPeak * 2 * Math.PI;
  const peakX = center + radius * Math.cos(peakAngle);
  const peakY = center + radius * Math.sin(peakAngle);
  const peakHue = 120 - clampedPeak * 120;
  const peakDotColor = `hsla(${peakHue}, 90%, 65%, 0.95)`;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="meter"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={
        muted ? "Audio muted" : `Audio level ${Math.round(clamped * 100)}%`
      }
    >
      {/* Background ring */}
      <svg width={size} height={size} className="absolute" aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        {/* Active ring – animated */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          className="transition-[stroke-dashoffset,stroke] duration-75 ease-linear"
          style={{
            filter:
              clamped > 0.7 ? `drop-shadow(0 0 4px ${ringColor})` : undefined,
          }}
        />

        {/* Peak-hold indicator dot (lingers 800ms) */}
        {showPeakHold && !muted && clampedPeak > 0.05 && (
          <circle
            data-testid="peak-hold-dot"
            cx={peakX}
            cy={peakY}
            r={Math.max(1.8, strokeWidth * 0.75)}
            fill={peakDotColor}
            className="transition-all duration-75"
            style={{
              filter: `drop-shadow(0 0 3px ${peakDotColor})`,
            }}
          />
        )}
      </svg>

      {/* Glow ring for loud audio */}
      {!muted && clamped > 0.6 && (
        <svg
          width={size + 8}
          height={size + 8}
          className="absolute animate-pulse"
          aria-hidden="true"
          style={{ opacity: (clamped - 0.6) * 2.5 }}
        >
          <circle
            cx={center + 4}
            cy={center + 4}
            r={radius + 2}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth * 0.5}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${center + 4} ${center + 4})`}
            className="transition-all duration-75 ease-linear"
          />
        </svg>
      )}

      {/* Muted indicator */}
      {muted && (
        <span
          className="absolute flex items-center justify-center rounded-full bg-white/10"
          style={{
            width: size * 0.35,
            height: size * 0.35,
          }}
          aria-hidden="true"
        >
          <svg
            width={size * 0.18}
            height={size * 0.18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        </span>
      )}

      {/* Children (avatar / video thumbnail) */}
      {children && (
        <div className="relative z-10 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}
