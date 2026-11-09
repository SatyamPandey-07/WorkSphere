"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Wifi,
  Zap,
  VolumeX,
  Accessibility,
  Sun,
  Coffee,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VenueFilterItem {
  id: string;
  label: string;
  paramKey: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface VenueFilterBarProps {
  /** Override the default filter list. */
  filters?: VenueFilterItem[];
  /** Controlled selected filter IDs. When omitted, URL params drive selection. */
  selectedFilters?: string[];
  /** Called when a filter is toggled. Receives (filterId, isNowActive). */
  onToggleFilter?: (filterId: string, active: boolean) => void;
  /** When true (default), selected state is read from / written to URL search params. */
  syncWithUrl?: boolean;
  /** Additional class names applied to the outermost wrapper element. */
  className?: string;
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// Default filter definitions
// ---------------------------------------------------------------------------

export const DEFAULT_VENUE_FILTERS: VenueFilterItem[] = [
  { id: "wifi", label: "Free Wi-Fi", paramKey: "wifi", icon: Wifi },
  { id: "outlets", label: "Power Outlets", paramKey: "outlets", icon: Zap },
  { id: "quiet", label: "Quiet Zone", paramKey: "quiet", icon: VolumeX },
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

// ---------------------------------------------------------------------------
// Scroll-mask helpers
//
// We use the CSS `mask-image` property (with webkit prefix for Safari) on the
// scroll container wrapper to fade out content near the edges when there is
// hidden overflow. This avoids adding extra DOM nodes for gradient overlays
// and works at the CSS compositing level (no layout impact on children).
//
// Gradient stops:
//   - Both edges hidden  → fade in from both left (0→8%) and right (92→100%)
//   - Only left hidden   → fade in from left only
//   - Only right hidden  → fade out to right only
//   - Neither            → no mask (full opacity)
// ---------------------------------------------------------------------------

type ScrollEdge = "none" | "left" | "right" | "both";

function buildMaskImage(edge: ScrollEdge): string {
  if (edge === "none") return "none";

  const leftFade =
    edge === "left" || edge === "both"
      ? "transparent 0%, black 10%"
      : "black 0%";

  const rightFade =
    edge === "right" || edge === "both"
      ? "black 90%, transparent 100%"
      : "black 100%";

  return `linear-gradient(to right, ${leftFade}, ${rightFade})`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * VenueFilterBar
 *
 * A horizontally scrollable row of filter pill buttons for the /venues page.
 *
 * Key features vs the simpler AmenityFilterPills:
 *  - Uses CSS `mask-image` linear-gradient on the scroll container for a
 *    native fade-out scroll indicator on both edges (no extra DOM nodes).
 *  - Each pill button meets the Apple HIG 44 × 44 pt minimum touch target.
 *  - Right-edge gradient appears automatically when content overflows (even
 *    on viewports narrower than 390 px).
 */
export function VenueFilterBar({
  filters = DEFAULT_VENUE_FILTERS,
  selectedFilters: controlledSelected,
  onToggleFilter,
  syncWithUrl = true,
  className = "",
  "data-testid": testId = "venue-filter-bar",
}: VenueFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollEdge, setScrollEdge] = useState<ScrollEdge>("none");

  // -------------------------------------------------------------------------
  // Derive active set from URL or controlled prop
  // -------------------------------------------------------------------------

  const activeSet = React.useMemo(() => {
    if (controlledSelected !== undefined) {
      return new Set(controlledSelected);
    }
    if (!searchParams) return new Set<string>();

    const set = new Set<string>();
    filters.forEach((f) => {
      const val = searchParams.get(f.paramKey);
      if (val === "true" || val === "1") set.add(f.id);
    });

    // Also honour comma-separated `amenities` param for interoperability
    const amenitiesParam = searchParams.get("amenities");
    if (amenitiesParam) {
      amenitiesParam.split(",").forEach((a) => set.add(a.trim()));
    }

    return set;
  }, [controlledSelected, searchParams, filters]);

  // -------------------------------------------------------------------------
  // Scroll-edge detection — drives the mask-image gradient
  // -------------------------------------------------------------------------

  const updateScrollEdge = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const atLeft = el.scrollLeft <= 4;
    const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;

    if (atLeft && atRight) {
      setScrollEdge("none");
    } else if (!atLeft && atRight) {
      setScrollEdge("left");
    } else if (atLeft && !atRight) {
      setScrollEdge("right");
    } else {
      setScrollEdge("both");
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Run once on mount so the initial state is correct before the user scrolls
    updateScrollEdge();

    el.addEventListener("scroll", updateScrollEdge, { passive: true });
    window.addEventListener("resize", updateScrollEdge);

    return () => {
      el.removeEventListener("scroll", updateScrollEdge);
      window.removeEventListener("resize", updateScrollEdge);
    };
  }, [updateScrollEdge, filters]);

  // -------------------------------------------------------------------------
  // Toggle handler
  // -------------------------------------------------------------------------

  const handleToggle = useCallback(
    (item: VenueFilterItem) => {
      const isActive = activeSet.has(item.id);
      const nextState = !isActive;

      onToggleFilter?.(item.id, nextState);

      if (syncWithUrl && pathname && router) {
        const params = new URLSearchParams(
          searchParams ? searchParams.toString() : "",
        );

        if (nextState) {
          params.set(item.paramKey, "true");
        } else {
          params.delete(item.paramKey);

          // Also clean up from the comma-separated `amenities` param
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

        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    },
    [activeSet, onToggleFilter, syncWithUrl, pathname, router, searchParams],
  );

  // -------------------------------------------------------------------------
  // Render — nothing if the filter list is empty
  // -------------------------------------------------------------------------

  if (filters.length === 0) return null;

  const maskImage = buildMaskImage(scrollEdge);

  return (
    <div
      data-testid={testId}
      className={cn("relative w-full overflow-hidden", className)}
    >
      {/*
        The mask-image is applied to this div (the visible viewport of the
        scroll container) so the gradient composites over whatever background
        is behind the pills without adding extra DOM elements.
        WebkitMaskImage is required for Safari / iOS.
      */}
      <div
        style={{
          WebkitMaskImage: maskImage,
          maskImage,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
          transition: "mask-image 150ms ease, -webkit-mask-image 150ms ease",
        }}
      >
        {/* Horizontally scrollable inner row */}
        <div
          ref={scrollRef}
          data-testid="venue-filter-bar-scroll"
          role="group"
          aria-label="Filter venues by amenity"
          className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 px-1 scroll-smooth touch-pan-x"
        >
          {filters.map((item) => {
            const isSelected = activeSet.has(item.id);
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                data-testid={`venue-filter-pill-${item.id}`}
                data-selected={isSelected}
                onClick={() => handleToggle(item)}
                /*
                 * Touch target: Apple HIG recommends a minimum of 44 × 44 pt.
                 * min-h-[44px] ensures the button is at least 44 px tall.
                 * px-3 + the icon/label content makes it at least 44 px wide
                 * for all labels in DEFAULT_VENUE_FILTERS; shrink-0 prevents
                 * flex compression. The pill shape (rounded-full) is preserved.
                 */
                className={cn(
                  "inline-flex items-center justify-center gap-1.5",
                  "min-h-[44px] px-3 rounded-full",
                  "text-xs font-semibold shrink-0 select-none",
                  "transition-all active:scale-95 border",
                  isSelected
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm hover:bg-blue-700 dark:bg-blue-600 dark:border-blue-500"
                    : "bg-zinc-100 hover:bg-zinc-200/80 text-zinc-700 border-zinc-200/80 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700/80",
                )}
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
    </div>
  );
}

export default VenueFilterBar;

