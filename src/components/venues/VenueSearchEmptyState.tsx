"use client";

import React from "react";
import { Search, MapPin, Wifi, Coffee } from "lucide-react";

interface VenueSearchEmptyStateProps {
  searchQuery?: string;
  className?: string;
}

export function VenueSearchEmptyState({
  searchQuery,
  className = "",
}: VenueSearchEmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-16 px-6 ${className}`}
      aria-live="polite"
      aria-label="No venues found"
    >
      {/* SVG Illustration */}
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="mb-6 opacity-60"
      >
        {/* Map base */}
        <rect
          x="15"
          y="35"
          width="90"
          height="60"
          rx="8"
          className="fill-zinc-100 dark:fill-zinc-800 stroke-zinc-300 dark:stroke-zinc-600"
          strokeWidth="2"
        />
        {/* Road lines */}
        <line
          x1="15"
          y1="65"
          x2="105"
          y2="65"
          className="stroke-zinc-200 dark:stroke-zinc-700"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
        <line
          x1="60"
          y1="35"
          x2="60"
          y2="95"
          className="stroke-zinc-200 dark:stroke-zinc-700"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
        {/* Magnifying glass */}
        <circle
          cx="68"
          cy="56"
          r="18"
          className="fill-white dark:fill-zinc-900 stroke-[var(--primary-accent,#2563eb)]"
          strokeWidth="3"
        />
        <line
          x1="82"
          y1="70"
          x2="94"
          y2="82"
          className="stroke-[var(--primary-accent,#2563eb)]"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Question mark inside magnifier */}
        <text
          x="68"
          y="62"
          textAnchor="middle"
          fontSize="16"
          fontWeight="bold"
          className="fill-zinc-400 dark:fill-zinc-500"
        >
          ?
        </text>
      </svg>

      <h3 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100 mb-2">
        No venues found
      </h3>
      {searchQuery ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 max-w-xs">
          We couldn&apos;t find any workspaces matching &ldquo;
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {searchQuery}
          </span>
          &rdquo;. Try broadening your search.
        </p>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 max-w-xs">
          We couldn&apos;t find any workspaces nearby. Try a different
          location or adjust your filters.
        </p>
      )}

      {/* Tips */}
      <ul className="space-y-2.5 text-left w-full max-w-xs">
        {[
          { icon: MapPin, text: "Try a different city or neighbourhood" },
          { icon: Wifi, text: "Remove strict WiFi speed requirements" },
          { icon: Coffee, text: "Include cafés and co-working spaces" },
          { icon: Search, text: "Use simpler keywords in your query" },
        ].map(({ icon: Icon, text }) => (
          <li
            key={text}
            className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"
          >
            <Icon className="w-4 h-4 shrink-0 text-[var(--primary-accent,#2563eb)] opacity-70" />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
