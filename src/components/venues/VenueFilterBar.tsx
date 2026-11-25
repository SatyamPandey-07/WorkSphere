"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUpDown, Monitor } from "lucide-react";
import { buildVenueSearchParams } from "@/lib/venues/searchQuery";
import {
  Wifi,
  Zap,
  VolumeX,
  Accessibility,
  Sun,
  Coffee,
  Check,
  SlidersHorizontal,
  Volume2,
  X,
  RotateCcw,
  LayoutGrid,
  Building2,
  BookOpen,
  MoveVertical,
  Monitor,
  Armchair,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DualRangeSlider } from "@/components/ui/DualRangeSlider";

// ---------------------------------------------------------------------------
// Types & Defaults
// ---------------------------------------------------------------------------

export interface VenueCategoryItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export const DEFAULT_VENUE_CATEGORIES: VenueCategoryItem[] = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "cafe", label: "Cafes", icon: Coffee },
  { id: "coworking", label: "Coworking", icon: Building2 },
  { id: "library", label: "Libraries", icon: BookOpen },
];

export interface VenueFilterOption {
  id: string;
  label: string;
  paramKey: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface VenueFilterBarProps {
  filters?: VenueFilterOption[];
  selectedIds?: string[];
  onToggleFilter?: (id: string, nextActive: boolean) => void;
  searchQuery?: string;
  existingSearchParams?: string;
  resultCount?: number;
  announcementDebounceMs?: number;
  onQueryParamsChange?: (queryString: string) => void;
  className?: string;
  /**
   * Search radius in km. If omitted, radius preference is restored from localStorage (#9890).
   */
  radius?: number;
  /**
   * Callback fired when search radius is changed.
   */
  onRadiusChange?: (radius: number) => void;
  /**
   * Whether to display the radius filter select dropdown. Default: true.
   */
  showRadiusFilter?: boolean;
}

export const DEFAULT_VENUE_AMENITY_FILTERS: VenueFilterOption[] = [
  { id: "dogFriendly", label: "Pet Friendly", paramKey: "dogFriendly" },
  { id: "veganOptions", label: "Vegan Options", paramKey: "veganOptions" },
  { id: "outdoorPatio", label: "Outdoor Seating", paramKey: "outdoorPatio" },
  {
    id: "standing_desks",
    label: "Standing Desk",
    paramKey: "standing_desks",
    icon: ArrowUpDown,
  },
  {
    id: "external_monitors",
    label: "External Monitor (4K/USB-C)",
    paramKey: "external_monitors",
    icon: Monitor,
  },
  {
    id: "standingDesk",
    label: "Standing Desk",
    paramKey: "standingDesk",
    icon: MoveVertical,
  },
  {
    id: "externalMonitor",
    label: "External Monitor",
    paramKey: "externalMonitor",
    icon: Monitor,
  },
  {
    id: "ergonomic",
    label: "Ergonomic Chair",
    paramKey: "ergonomic",
    icon: Armchair,
  },
  {
    id: "coffee",
    label: "Specialty Coffee",
    paramKey: "coffee",
    icon: Coffee,
  },
];

export const VenueFilterBar: React.FC<VenueFilterBarProps> = ({
  filters = DEFAULT_VENUE_AMENITY_FILTERS,
  selectedIds,
  onToggleFilter,
  searchQuery,
  existingSearchParams = "",
  resultCount,
  announcementDebounceMs = 200,
  onQueryParamsChange,
  className = "",
  radius: propRadius,
  onRadiusChange,
  showRadiusFilter = true,
}) => {
  const { radius: preferenceRadius, setRadius } = useSearchPreferences({
    initialRadius: propRadius,
    onRadiusChange,
  });

  const activeRadius = propRadius !== undefined ? propRadius : preferenceRadius;
  const [internalSelected, setInternalSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>(selectedIds ?? []);
    const params = new URLSearchParams(existingSearchParams);
    filters.forEach((f) => {
      const val = params.get(f.paramKey);
      if (
        val === "true" ||
        val === "1" ||
        (f.paramKey === "minWifiSpeed" && (val === "100" || Number(val) >= 100))
      ) {
        initial.add(f.id);
      }
    });
    const amenitiesParam = params.get("amenities");
    if (amenitiesParam) {
      amenitiesParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((a) => initial.add(a));
    }
    return initial;
  });

  const activeSet = useMemo(() => {
    return selectedIds !== undefined ? new Set(selectedIds) : internalSelected;
  }, [selectedIds, internalSelected]);

  const hasMountedRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    const timer = window.setTimeout(
      () => {
        if (typeof resultCount === "number" && Number.isFinite(resultCount)) {
          setAnnouncement(
            resultCount === 0
              ? "No venues match the selected filters."
              : `${resultCount} venues match the selected filters.`,
          );
          return;
        }

        setAnnouncement(
          activeSet.size === 0
            ? "All amenity filters cleared."
            : `${activeSet.size} amenity filter${activeSet.size === 1 ? "" : "s"} active.`,
        );
      },
      Math.max(0, announcementDebounceMs),
    );

    return () => window.clearTimeout(timer);
  }, [activeSet, searchQuery, resultCount, announcementDebounceMs]);

  const handleToggle = useCallback(
    (item: VenueFilterOption) => {
      const nextActive = !activeSet.has(item.id);
      const nextSet = new Set(activeSet);
      if (nextActive) {
        nextSet.add(item.id);
      } else {
        nextSet.delete(item.id);
      }

      if (selectedIds === undefined) {
        setInternalSelected(nextSet);
      }

      onToggleFilter?.(item.id, nextActive);

      const isLightningWifiActive =
        nextSet.has("lightning_wifi") ||
        nextSet.has("minWifiSpeed") ||
        filters.some((f) => f.paramKey === "minWifiSpeed" && nextSet.has(f.id));

      const params = buildVenueSearchParams(
        {
          q: searchQuery,
          amenities: Array.from(nextSet),
          minWifiSpeed: isLightningWifiActive ? 100 : undefined,
        },
        existingSearchParams,
      );

      filters.forEach((f) => {
        if (nextSet.has(f.id)) {
          if (f.paramKey === "minWifiSpeed") {
            params.set("minWifiSpeed", "100");
          } else {
            params.set(f.paramKey, "true");
          }
        } else {
          params.delete(f.paramKey);
        }
      });

      onQueryParamsChange?.(params.toString());
    },
    [
      activeSet,
      selectedIds,
      onToggleFilter,
      searchQuery,
      existingSearchParams,
      filters,
      onQueryParamsChange,
    ],
  );

  return (
    <div
      role="group"
      aria-label="Venue amenity filters"
      data-testid="venue-filter-bar"
      className={`flex flex-wrap items-center gap-2 ${className}`.trim()}
    >
      <span
        role="status"
        aria-live="polite"
        data-testid="venue-filter-live-region"
        className="sr-only"
      >
        {announcement}
      </span>

      {filters.map((item) => {
        const isActive = activeSet.has(item.id);
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isActive}
            data-testid={`venue-filter-chip-${item.id}`}
            onClick={() => handleToggle(item)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                handleToggle(item);
              }
            }}
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              isActive
                ? "border-indigo-600 bg-indigo-600 text-white shadow-xs"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
            <span>{item.label}</span>
          </button>
        );
      })}

      {showRadiusFilter && (
        <div className="inline-flex items-center gap-1.5 ml-auto text-xs font-semibold text-slate-600 dark:text-slate-300">
          <label htmlFor="venue-filter-radius-select" className="text-xs">
            Radius:
          </label>
          <select
            id="venue-filter-radius-select"
            data-testid="venue-filter-radius-select"
            aria-label="Filter radius"
            value={activeRadius}
            onChange={(e) => {
              const val = Number(e.target.value);
              setRadius(val);
            }}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {ALLOWED_RADIUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 0
                  ? "Any distance"
                  : opt < 1
                    ? `${opt * 1000}m`
                    : `${opt}km`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

export default VenueFilterBar;
