"use client";

import React, { useId, useState } from "react";
import { Volume2, ChevronDown, ChevronUp, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VenueAcousticCardProps {
  venue?: {
    id: string;
    name: string;
    noiseLevel?: string | number | null;
    decibels?: number | null;
  } | null;
  noiseLevel?: string | number | null;
  decibels?: number | null;
  className?: string;
  testId?: string;
  defaultExpanded?: boolean;
}

const TIER_COLORS: Record<string, string> = {
  quiet: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  moderate: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  loud: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
};

const DEFAULT_DB_BY_TIER: Record<string, number> = {
  quiet: 42,
  moderate: 58,
  loud: 76,
};

export function VenueAcousticCard({
  venue,
  noiseLevel,
  decibels,
  className = "",
  testId = "venue-acoustic-card",
  defaultExpanded = false,
}: VenueAcousticCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const generatedId = useId();
  const triggerId = `acoustic-breakdown-trigger-${generatedId}`;
  const panelId = `acoustic-breakdown-panel-${generatedId}`;

  const venueName = venue?.name ?? "Workspace";
  const rawNoiseLevel = String(venue?.noiseLevel ?? noiseLevel ?? "moderate")
    .trim()
    .toLowerCase();
  const tier = rawNoiseLevel.includes("quiet")
    ? "quiet"
    : rawNoiseLevel.includes("loud")
      ? "loud"
      : "moderate";

  const effectiveDb =
    typeof decibels === "number" && Number.isFinite(decibels)
      ? decibels
      : typeof venue?.decibels === "number" && Number.isFinite(venue.decibels)
        ? venue.decibels
        : (DEFAULT_DB_BY_TIER[tier] ?? 58);

  const tierBadgeColor = TIER_COLORS[tier] ?? TIER_COLORS.moderate;

  const handleToggle = () => {
    setIsExpanded((prev) => !prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <div
      role="region"
      aria-label={`Acoustic details for ${venueName}`}
      data-testid={testId}
      className={cn(
        "p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-3 transition-all",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
            <Volume2 className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h4
              className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-zinc-100"
              data-testid="acoustic-card-title"
            >
              Sound Environment
            </h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              <span className="capitalize">{tier}</span> • {effectiveDb} dB
            </p>
          </div>
        </div>
        <span
          className={cn(
            "text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider",
            tierBadgeColor,
          )}
          data-testid="acoustic-tier-badge"
        >
          {tier}
        </span>
      </div>

      {/* Accordion Section */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm transition-all">
        <button
          type="button"
          id={triggerId}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-blue-500" aria-hidden="true" />
            <span className="text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Acoustic Breakdown
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-500" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500" aria-hidden="true" />
          )}
        </button>

        {isExpanded && (
          <div
            id={panelId}
            role="region"
            aria-labelledby={triggerId}
            data-testid="acoustic-breakdown-panel"
            className="px-4 pb-4 pt-1 border-t border-zinc-100 dark:border-zinc-800/60"
          >
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-2.5 pt-1">
              Estimated frequency band distribution based on {tier} ambient noise profile:
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800/80 text-center">
                <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Bass (Low)
                </span>
                <span className="text-xs font-black text-sky-500 mt-0.5 block">
                  {Math.max(20, effectiveDb - 8)} dB
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800/80 text-center">
                <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Mid (Speech)
                </span>
                <span className="text-xs font-black text-emerald-500 mt-0.5 block">
                  {effectiveDb} dB
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800/80 text-center">
                <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Treble (High)
                </span>
                <span className="text-xs font-black text-rose-500 mt-0.5 block">
                  {Math.max(20, effectiveDb - 12)} dB
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default VenueAcousticCard;
