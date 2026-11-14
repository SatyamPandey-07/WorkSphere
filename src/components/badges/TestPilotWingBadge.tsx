"use client";

import { useId, useState } from "react";

export interface TestPilotWingBadgeProps {
  className?: string;
  testId?: string;
}

const TOOLTIP_TEXT =
  "Test Pilot Wings: Awarded for high-velocity global coworking missions.";

export function TestPilotWingBadge({
  className = "",
  testId = "test-pilot-wing-badge",
}: TestPilotWingBadgeProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const tooltipId = useId();

  return (
    <div className="relative inline-flex">
      <span
        role="img"
        aria-label="Test Pilot Wings badge"
        aria-describedby={isTooltipVisible ? tooltipId : undefined}
        data-testid={testId}
        tabIndex={0}
        onMouseEnter={() => setIsTooltipVisible(true)}
        onMouseLeave={() => setIsTooltipVisible(false)}
        onFocus={() => setIsTooltipVisible(true)}
        onBlur={() => setIsTooltipVisible(false)}
        className={`inline-flex items-center gap-2 rounded-full border border-emerald-600/30 bg-gradient-to-r from-zinc-100 via-white to-emerald-50 px-3 py-2 text-emerald-900 shadow-sm transition-all duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:border-emerald-400/30 dark:from-zinc-800 dark:via-zinc-900 dark:to-emerald-950 dark:text-emerald-200 dark:focus-visible:ring-offset-zinc-900 ${className}`.trim()}
      >
        <svg
          viewBox="0 0 120 52"
          className="h-7 w-16 shrink-0"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${tooltipId}-silver`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F8FAFC" />
              <stop offset="100%" stopColor="#94A3B8" />
            </linearGradient>
            <linearGradient id={`${tooltipId}-emerald`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#34D399" />
              <stop offset="100%" stopColor="#047857" />
            </linearGradient>
          </defs>

          {/* Left and right aerodynamic wings */}
          <path
            d="M54 23 L5 5 L17 17 L8 17 L28 27 L20 28 L45 34 L54 29 Z"
            fill={`url(#${tooltipId}-silver)`}
            stroke="#64748B"
            strokeWidth="1"
          />
          <path
            d="M66 23 L115 5 L103 17 L112 17 L92 27 L100 28 L75 34 L66 29 Z"
            fill={`url(#${tooltipId}-silver)`}
            stroke="#64748B"
            strokeWidth="1"
          />

          {/* Feather detailing */}
          <path d="M13 9 L48 24 M20 18 L47 28 M30 25 L48 31" stroke="#64748B" strokeWidth="1" />
          <path d="M107 9 L72 24 M100 18 L73 28 M90 25 L72 31" stroke="#64748B" strokeWidth="1" />

          {/* Central emerald flight insignia */}
          <circle cx="60" cy="25" r="14" fill={`url(#${tooltipId}-emerald)`} stroke="#A7F3D0" strokeWidth="2" />
          <path
            d="M60 15 L64 22 L71 25 L64 28 L60 35 L56 28 L49 25 L56 22 Z"
            fill="#ECFDF5"
            stroke="#065F46"
            strokeWidth="1"
          />
        </svg>

        <span className="whitespace-nowrap text-xs font-bold tracking-wide">
          TEST PILOT
        </span>
      </span>

      <div
        id={tooltipId}
        role="tooltip"
        data-testid="test-pilot-wing-tooltip"
        hidden={!isTooltipVisible}
        className="absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs leading-relaxed text-zinc-700 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        {TOOLTIP_TEXT}
      </div>
    </div>
  );
}

export default TestPilotWingBadge;
