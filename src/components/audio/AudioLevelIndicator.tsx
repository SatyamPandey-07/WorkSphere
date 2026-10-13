"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export const DEFAULT_DECAY_FACTOR = 0.2;
export const AUDIO_DECAY_TIMEOUT_MS = 300;

/**
 * Linear interpolation (lerp) decay step function.
 * Smooths current level towards target level with given decay factor.
 */
export function lerpDecay(
  currentLevel: number,
  targetLevel: number,
  decayFactor: number = DEFAULT_DECAY_FACTOR
): number {
  return currentLevel + (targetLevel - currentLevel) * decayFactor;
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
  /** Decay factor for linear interpolation (default 0.2) */
  decayFactor?: number;
  /** Content to render inside the ring */
  children?: ReactNode;
};

/**
 * AudioLevelIndicator renders a circular audio volume meter around a child element.
 * Smoothly decays volume levels using requestAnimationFrame and linear interpolation (lerp).
 */
export function AudioLevelIndicator({
  level,
  size = 80,
  strokeWidth = 3,
  muted = false,
  decayFactor = DEFAULT_DECAY_FACTOR,
  children,
}: AudioLevelIndicatorProps): ReactNode {
  const initialClamped = Math.min(1, Math.max(0, muted ? 0 : Number.isFinite(level) ? level : 0));
  const [displayLevel, setDisplayLevel] = useState<number>(initialClamped);
  const currentDisplayLevelRef = useRef<number>(initialClamped);
  const targetLevelRef = useRef<number>(initialClamped);
  const lastActiveTimeRef = useRef<number>(performance.now());
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const target = Math.min(1, Math.max(0, muted ? 0 : Number.isFinite(level) ? level : 0));
    targetLevelRef.current = target;
    if (target > 0) {
      lastActiveTimeRef.current = performance.now();
    }

    const animate = () => {
      const current = currentDisplayLevelRef.current;
      const targetLevel = targetLevelRef.current;

      if (targetLevel >= current) {
        // Fast attack: jump up immediately to catch speech transients
        currentDisplayLevelRef.current = targetLevel;
        setDisplayLevel(targetLevel);
        lastActiveTimeRef.current = performance.now();
      } else {
        // Smooth decay via linear interpolation
        let next = lerpDecay(current, targetLevel, decayFactor);

        // Fallback clamp: ensure level reaches 0 within 300ms when audio stops
        if (targetLevel === 0 && performance.now() - lastActiveTimeRef.current >= AUDIO_DECAY_TIMEOUT_MS) {
          next = 0;
        } else if (Math.abs(next - targetLevel) < 0.005) {
          next = targetLevel;
        }

        currentDisplayLevelRef.current = next;
        setDisplayLevel(next);

        if (Math.abs(next - targetLevel) > 0.001) {
          rafIdRef.current = requestAnimationFrame(animate);
          return;
        }
      }

      if (Math.abs(currentDisplayLevelRef.current - targetLevelRef.current) > 0.001) {
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
  }, [level, muted, decayFactor]);

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
