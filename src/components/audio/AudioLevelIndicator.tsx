"use client";

import { type ReactNode } from "react";

type AudioLevelIndicatorProps = {
  /** Normalized audio level 0–1 */
  level: number;
  /** Diameter in px (default 80) */
  size?: number;
  /** Ring stroke width (default 3) */
  strokeWidth?: number;
  /** Show muted state */
  muted?: boolean;
  /** Content to render inside the ring */
  children?: ReactNode;
};

/**
 * AudioLevelIndicator renders a circular audio volume meter around a child element.
 */
export function AudioLevelIndicator({
  level,
  size = 80,
  strokeWidth = 3,
  muted = false,
  children,
}: AudioLevelIndicatorProps): ReactNode {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Map 0–1 level to 0–circumference arc length (16% min visible ring)
  const clamped = Math.min(1, Math.max(0, muted ? 0 : level));
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
