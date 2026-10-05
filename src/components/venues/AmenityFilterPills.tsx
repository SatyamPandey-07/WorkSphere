"use client";

import React, { useRef, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Wifi,
  Zap,
  VolumeX,
  Accessibility,
  Sun,
  Coffee,
  Check,
  Sparkles,
} from "lucide-react";

export interface AmenityFilterItem {
  id: string;
  label: string;
  paramKey: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const POPULAR_AMENITIES: AmenityFilterItem[] = [
  {
    id: "wifi",
    label: "Free Wi-Fi",
    paramKey: "wifi",
    icon: Wifi,
  },
  {
    id: "outlets",
    label: "Power Outlets",
    paramKey: "outlets",
    icon: Zap,
  },
  {
    id: "quiet",
    label: "Quiet Zone",
    paramKey: "quiet",
    icon: VolumeX,
  },
  {
    id: "wheelchair",
    label: "Wheelchair Accessible",
    paramKey: "wheelchair",
    icon: Accessibility,
  },
  {
    id: "outdoor",
    label: "Outdoor Seating",
    paramKey: "outdoor",
    icon: Sun,
  },
  {
    id: "coffee",
    label: "Specialty Coffee",
    paramKey: "coffee",
    icon: Coffee,
  },
];

export interface AmenityFilterPillsProps {
  className?: string;
  amenities?: AmenityFilterItem[];
  selectedAmenities?: string[];
  onToggleAmenity?: (amenityId: string, active: boolean) => void;
  syncWithUrl?: boolean;
}

/**
 * AmenityFilterPills:
 * Horizontally scrollable pill row for single-tap amenity filtering on mobile screens.
 * Dynamically updates URL search parameters and notifies parent state.
 */
export function AmenityFilterPills({
  className = "",
  amenities = POPULAR_AMENITIES,
  selectedAmenities: controlledSelected,
  onToggleAmenity,
  syncWithUrl = true,
}: AmenityFilterPillsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Derive active amenities from URL params or controlled prop
  const activeSet = React.useMemo(() => {
    if (controlledSelected !== undefined) {
      return new Set(controlledSelected);
    }
    if (!searchParams) return new Set<string>();

    const set = new Set<string>();
    amenities.forEach((item) => {
      const val = searchParams.get(item.paramKey);
      if (val === "true" || val === "1") {
        set.add(item.id);
      }
    });

    // Also check comma-separated 'amenities' param if present
    const amenitiesParam = searchParams.get("amenities");
    if (amenitiesParam) {
      amenitiesParam.split(",").forEach((a) => set.add(a.trim()));
    }

    return set;
  }, [controlledSelected, searchParams, amenities]);

  // Check scroll bounds for smooth scroll indicator
  const updateScrollIndicators = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScrollIndicators();
    const el = scrollContainerRef.current;
    if (!el) return;

    el.addEventListener("scroll", updateScrollIndicators, { passive: true });
    window.addEventListener("resize", updateScrollIndicators);

    return () => {
      el.removeEventListener("scroll", updateScrollIndicators);
      window.removeEventListener("resize", updateScrollIndicators);
    };
  }, []);

  const handleToggle = (item: AmenityFilterItem) => {
    const isActive = activeSet.has(item.id);
    const nextState = !isActive;

    onToggleAmenity?.(item.id, nextState);

    if (syncWithUrl && pathname && router) {
      const params = new URLSearchParams(searchParams ? searchParams.toString() : "");

      if (nextState) {
        params.set(item.paramKey, "true");
      } else {
        params.delete(item.paramKey);
        const list = new Set(
          (params.get("amenities") || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        list.delete(item.id);
        list.delete(item.paramKey);
        if (list.size > 0) {
          params.set("amenities", [...list].join(","));
        } else {
          params.delete("amenities");
        }
      }

      const queryString = params.toString();
      const nextUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(nextUrl, { scroll: false });
    }
  };

  return (
    <div
      className={`relative w-full ${className}`}
      data-testid="amenity-filter-pills-container"
    >
      {/* Smooth gradient shadow indicator for scrollable content on left */}
      {canScrollLeft && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white dark:from-zinc-900 to-transparent z-10 transition-opacity"
        />
      )}

      {/* Smooth gradient shadow indicator for scrollable content on right */}
      {canScrollRight && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white dark:from-zinc-900 to-transparent z-10 transition-opacity"
        />
      )}

      {/* Horizontally scrollable container */}
      <div
        ref={scrollContainerRef}
        data-testid="amenity-pills-scroll"
        className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 px-1 scroll-smooth touch-pan-x"
        role="group"
        aria-label="Filter venues by amenities"
      >
        {amenities.map((item) => {
          const isSelected = activeSet.has(item.id);
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              data-testid={`amenity-pill-${item.id}`}
              data-selected={isSelected}
              onClick={() => handleToggle(item)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all active:scale-95 border select-none ${
                isSelected
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm hover:bg-blue-700 dark:bg-blue-600 dark:border-blue-500"
                  : "bg-zinc-100 hover:bg-zinc-200/80 text-zinc-700 border-zinc-200/80 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700/80"
              }`}
            >
              {isSelected ? (
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              ) : (
                <Icon className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
              )}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default AmenityFilterPills;
