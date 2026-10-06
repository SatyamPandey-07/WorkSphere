"use client";

import React, { useMemo, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Volume2, Volume1, VolumeX } from "lucide-react";

export type NoiseTag = "quiet" | "moderate" | "energetic";

export interface NoiseOption {
  id: NoiseTag;
  label: string;
  dbRange: string;
  maxDb: number;
  minDb: number;
  icon: React.ComponentType<{ className?: string }>;
}

export const NOISE_OPTIONS: NoiseOption[] = [
  {
    id: "quiet",
    label: "Quiet",
    dbRange: "< 50dB",
    minDb: 0,
    maxDb: 50,
    icon: VolumeX,
  },
  {
    id: "moderate",
    label: "Moderate",
    dbRange: "50-70dB",
    minDb: 50,
    maxDb: 70,
    icon: Volume1,
  },
  {
    id: "energetic",
    label: "Energetic",
    dbRange: "> 70dB",
    minDb: 70,
    maxDb: 120,
    icon: Volume2,
  },
];

/**
 * Categorize a telemetry average noise score (in dB) into a noise tag.
 * Quiet: < 50dB, Moderate: 50-70dB, Energetic: > 70dB
 */
export function classifyNoiseLevel(dBScore: number): NoiseTag {
  if (dBScore < 50) return "quiet";
  if (dBScore <= 70) return "moderate";
  return "energetic";
}

export interface VenueWithTelemetry {
  id?: string;
  name?: string;
  noiseLevel?: string;
  averageNoise?: number | null;
  telemetry?: {
    averageNoise?: number | null;
    noiseScore?: number | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/**
 * Filter venue cards matching telemetry average noise score or noise level tag.
 */
export function filterVenuesByNoise<T extends VenueWithTelemetry>(
  venues: T[],
  selectedTags: NoiseTag[] | string[],
): T[] {
  if (!selectedTags || selectedTags.length === 0 || selectedTags.includes("all" as any)) {
    return venues;
  }

  const normalizedTags = new Set(
    selectedTags.map((t) => (t === "loud" ? "energetic" : t.toLowerCase())),
  );

  return venues.filter((venue) => {
    // 1. Check direct average noise score from telemetry or venue property
    const noiseScore =
      venue.telemetry?.averageNoise ??
      venue.telemetry?.noiseScore ??
      venue.averageNoise;

    if (typeof noiseScore === "number" && !isNaN(noiseScore)) {
      const tag = classifyNoiseLevel(noiseScore);
      if (normalizedTags.has(tag)) return true;
    }

    // 2. Fallback to noise level string property
    if (venue.noiseLevel) {
      const level = venue.noiseLevel.toLowerCase();
      const mappedLevel = level === "loud" ? "energetic" : level;
      if (normalizedTags.has(mappedLevel)) return true;
    }

    return false;
  });
}

export interface VenueFilterProps {
  selectedNoiseLevels?: string[];
  onChange?: (noiseLevels: string[]) => void;
  className?: string;
}

/**
 * Noise filter selector component for venue search.
 * Allows multi-selecting noise level tags (Quiet < 50dB, Moderate 50-70dB, Energetic > 70dB).
 * Updates URL search params (`?noise=quiet,moderate`).
 */
export function VenueFilter({
  selectedNoiseLevels: externalSelected,
  onChange,
  className = "",
}: VenueFilterProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read noise filter from URL search params (e.g. noise=quiet,moderate)
  const urlNoiseLevels = useMemo(() => {
    if (!searchParams) return [];
    const raw = searchParams.get("noise") ?? searchParams.get("noiseLevel");
    if (!raw || raw === "all") return [];
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }, [searchParams]);

  const activeSelected = externalSelected ?? urlNoiseLevels;

  const handleToggleNoiseTag = useCallback(
    (tag: NoiseTag) => {
      let next: string[];
      if (activeSelected.includes(tag)) {
        next = activeSelected.filter((t) => t !== tag);
      } else {
        next = [...activeSelected, tag];
      }

      if (onChange) {
        onChange(next);
      }

      // Synchronize with URL search params
      if (searchParams && router && pathname) {
        const params = new URLSearchParams(searchParams.toString());
        if (next.length > 0) {
          params.set("noise", next.join(","));
          params.delete("noiseLevel");
        } else {
          params.delete("noise");
          params.delete("noiseLevel");
        }
        const queryString = params.toString();
        const targetUrl = `${pathname}${queryString ? `?${queryString}` : ""}`;
        router.replace(targetUrl, { scroll: false });
      }
    },
    [activeSelected, onChange, searchParams, router, pathname],
  );

  return (
    <div className={`space-y-2 ${className}`} data-testid="venue-noise-filter">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Noise Level
        </label>
        {activeSelected.length > 0 && (
          <button
            type="button"
            data-testid="clear-noise-filter-btn"
            onClick={() => {
              if (onChange) onChange([]);
              if (searchParams && router && pathname) {
                const params = new URLSearchParams(searchParams.toString());
                params.delete("noise");
                params.delete("noiseLevel");
                const queryString = params.toString();
                const targetUrl = `${pathname}${queryString ? `?${queryString}` : ""}`;
                router.replace(targetUrl, { scroll: false });
              }
            }}
            className="text-[11px] font-bold text-rose-500 hover:underline"
          >
            Clear Noise
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by Noise Level">
        {NOISE_OPTIONS.map((option) => {
          const isSelected = activeSelected.includes(option.id);
          const Icon = option.icon;

          return (
            <button
              key={option.id}
              type="button"
              data-testid={`noise-filter-${option.id}`}
              aria-pressed={isSelected}
              onClick={() => handleToggleNoiseTag(option.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                isSelected
                  ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-400/60"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{option.label}</span>
              <span className={`text-[10px] opacity-80 font-normal ${isSelected ? "text-blue-100" : "text-zinc-400"}`}>
                ({option.dbRange})
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
