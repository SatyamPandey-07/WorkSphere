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

/**
 * Sanitizes and clamps venue capacity filter inputs.
 * Clamps to integers >= 1; non-numeric, NaN, or negative inputs are rejected/defaulted to minimum 1.
 */
export function sanitizeCapacityInput(
  value: unknown,
  defaultValue: number = 1,
): number {
  if (value === undefined || value === null || value === "") {
    return Math.max(1, Math.floor(defaultValue) || 1);
  }
  const num = typeof value === "number" ? value : Number(value);
  if (isNaN(num) || !isFinite(num)) {
    return Math.max(1, Math.floor(defaultValue) || 1);
  }
  return Math.max(1, Math.floor(num));
}

export interface VenueWithTelemetry {
  id?: string;
  name?: string;
  noiseLevel?: string;
  averageNoise?: number | null;
  capacity?: number | null;
  meetingRoomCapacity?: number | null;
  maxCapacity?: number | null;
  rating?: number | null;
  averageRating?: number | null;
  telemetry?: {
    averageNoise?: number | null;
    noiseScore?: number | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface SortOption {
  id: string;
  label: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { id: "default", label: "Default" },
  { id: "rating_desc", label: "Rating: High to Low" },
  { id: "rating_asc", label: "Rating: Low to High" },
];

/**
 * Sort venue listings by average user rating (Highest Rated first / Lowest Rated first).
 * "rating_desc": Highest Rated first (High to Low)
 * "rating_asc": Lowest Rated first (Low to High)
 * Handles null, undefined, or missing rating / averageRating safely (defaults to 0).
 * Does not mutate the original array.
 */
export function sortVenuesByRating<
  T extends { rating?: number | null; averageRating?: number | null }
>(venues: T[], sortBy: string): T[] {
  if (sortBy !== "rating_asc" && sortBy !== "rating_desc") {
    return [...venues];
  }
  return [...venues].sort((a, b) => {
    const rateA = a.averageRating ?? a.rating ?? 0;
    const rateB = b.averageRating ?? b.rating ?? 0;
    return sortBy === "rating_asc" ? rateA - rateB : rateB - rateA;
  });
}

/**
 * Filter venues by minimum seating / room capacity.
 * Clamps input to integers >= 1, safely handling NaN, non-numeric, or negative capacity parameters.
 */
export function filterVenuesByCapacity<T extends VenueWithTelemetry>(
  venues: T[],
  minCapacity: unknown,
): T[] {
  const target = sanitizeCapacityInput(minCapacity);
  return venues.filter((venue) => {
    const cap =
      venue.capacity ??
      venue.meetingRoomCapacity ??
      venue.maxCapacity;
    return typeof cap === "number" && !isNaN(cap) && cap >= target;
  });
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
  sortBy?: string;
  onSortChange?: (sortBy: string) => void;
  className?: string;
}

/**
 * Filter and sort selector component for venue search.
 * Allows multi-selecting noise level tags and sorting venue listings by average user rating.
 * Updates URL search params (`?noise=quiet,moderate&sortBy=rating_desc`).
 */
export function VenueFilter({
  selectedNoiseLevels: externalSelected,
  onChange,
  sortBy: externalSortBy,
  onSortChange,
  className = "",
}: VenueFilterProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Helper for router navigation that supports push and replace
  const navigate = useCallback(
    (targetUrl: string) => {
      if (!router) return;
      const navFn = (router.replace || router.push)?.bind(router);
      if (navFn) {
        navFn(targetUrl, { scroll: false });
      }
    },
    [router],
  );

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

  // Read sort option from URL search params (e.g. sortBy=rating_desc)
  const urlSortBy = useMemo(() => {
    if (!searchParams) return "default";
    const raw = searchParams.get("sortBy") ?? searchParams.get("sort");
    return raw || "default";
  }, [searchParams]);

  const activeSortBy = externalSortBy ?? urlSortBy;

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
      if (searchParams && pathname) {
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
        navigate(targetUrl);
      }
    },
    [activeSelected, onChange, searchParams, pathname, navigate],
  );

  const handleSortChange = useCallback(
    (newSort: string) => {
      if (onSortChange) {
        onSortChange(newSort);
      }

      // Synchronize with URL search params
      if (searchParams && pathname) {
        const params = new URLSearchParams(searchParams.toString());
        if (newSort && newSort !== "default") {
          params.set("sortBy", newSort);
          params.delete("sort");
        } else {
          params.delete("sortBy");
          params.delete("sort");
        }
        const queryString = params.toString();
        const targetUrl = `${pathname}${queryString ? `?${queryString}` : ""}`;
        navigate(targetUrl);
      }
    },
    [onSortChange, searchParams, pathname, navigate],
  );

  return (
    <div className={`space-y-4 ${className}`} data-testid="venue-filter-container">
      {/* Noise Level Filter */}
      <div className="space-y-2" data-testid="venue-noise-filter">
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
                if (searchParams && pathname) {
                  const params = new URLSearchParams(searchParams.toString());
                  params.delete("noise");
                  params.delete("noiseLevel");
                  const queryString = params.toString();
                  const targetUrl = `${pathname}${queryString ? `?${queryString}` : ""}`;
                  navigate(targetUrl);
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

      {/* Sort By Dropdown */}
      <div className="space-y-1.5" data-testid="venue-sort-container">
        <div className="flex items-center justify-between">
          <label
            htmlFor="venue-rating-sort-select"
            className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
          >
            Sort By
          </label>
          {activeSortBy !== "default" && (
            <button
              type="button"
              data-testid="clear-sort-btn"
              onClick={() => handleSortChange("default")}
              className="text-[11px] font-bold text-rose-500 hover:underline"
            >
              Reset Sort
            </button>
          )}
        </div>
        <div className="relative">
          <select
            id="venue-rating-sort-select"
            data-testid="venue-sort-select"
            value={activeSortBy}
            onChange={(e) => handleSortChange(e.target.value)}
            aria-label="Sort venue listings by rating or default"
            className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer appearance-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400">
            <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
              <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
