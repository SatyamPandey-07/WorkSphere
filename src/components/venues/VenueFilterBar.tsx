"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { motion, LayoutGroup } from "framer-motion";
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
  /** Category tabs list. When provided or by default, renders category pill tabs. */
  categories?: VenueCategoryItem[];
  /** Controlled active category tab ID. */
  selectedCategory?: string;
  /** Alias for selectedCategory */
  activeCategory?: string;
  /** Called when a category tab is clicked or navigated to. Receives (categoryId). */
  onSelectCategory?: (categoryId: string) => void;
  /** Alias for onSelectCategory */
  onCategoryChange?: (categoryId: string) => void;
  /** Whether to show category tabs. Defaults to true. */
  showCategoryTabs?: boolean;
  /** When true (default), selected state is read from / written to URL search params. */
  syncWithUrl?: boolean;
  /** Custom decibel range filter [min, max] (dB) */
  decibelRange?: [number, number];
  /** Callback fired when decibel range changes */
  onDecibelRangeChange?: (range: [number, number]) => void;
  /** Custom WiFi speed range filter [min, max] (Mbps) */
  wifiSpeedRange?: [number, number];
  /** Callback fired when WiFi speed range changes */
  onWifiSpeedRangeChange?: (range: [number, number]) => void;
  /** Whether to show the custom range filters popover. Default: true */
  showCustomRangeFilters?: boolean;
  /** Additional class names applied to the outermost wrapper element. */
  className?: string;
  "data-testid"?: string;
}

export const DEFAULT_DECIBEL_RANGE: [number, number] = [30, 85];
export const DEFAULT_WIFI_RANGE: [number, number] = [10, 300];

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
 * A horizontally scrollable row of category tabs and filter pill buttons for the /venues page.
 *
 * Key features:
 *  - Smooth pill tab sliding indicator using Framer Motion layoutId="activeFilterPill"
 *    with a responsive spring transition (stiffness: 450, damping: 30).
 *  - Keyboard navigation (ArrowLeft / ArrowRight / Home / End) to cycle through category tabs.
 *  - Apple HIG 44 × 44 pt minimum touch target on all interactive pills.
 *  - Uses CSS `mask-image` linear-gradient on the scroll container for smooth edge fade-out.
 */
export function VenueFilterBar({
  filters = DEFAULT_VENUE_FILTERS,
  selectedFilters: controlledSelected,
  onToggleFilter,
  categories = DEFAULT_VENUE_CATEGORIES,
  selectedCategory: controlledSelectedCategory,
  activeCategory: controlledActiveCategory,
  onSelectCategory,
  onCategoryChange,
  showCategoryTabs = true,
  syncWithUrl = true,
  decibelRange: controlledDecibels,
  onDecibelRangeChange,
  wifiSpeedRange: controlledWifi,
  onWifiSpeedRangeChange,
  showCustomRangeFilters = true,
  className = "",
  "data-testid": testId = "venue-filter-bar",
}: VenueFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const scrollRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [scrollEdge, setScrollEdge] = useState<ScrollEdge>("none");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  // -------------------------------------------------------------------------
  // Category tabs state & URL sync
  // -------------------------------------------------------------------------

  const urlCategory = React.useMemo(() => {
    if (!searchParams) return null;
    return searchParams.get("category");
  }, [searchParams]);

  const [internalCategory, setInternalCategory] = useState<string>(() => {
    const controlled = controlledSelectedCategory ?? controlledActiveCategory;
    if (controlled !== undefined) return controlled;
    if (urlCategory) return urlCategory;
    return categories.length > 0 ? categories[0].id : "all";
  });

  useEffect(() => {
    const controlled = controlledSelectedCategory ?? controlledActiveCategory;
    if (controlled !== undefined) {
      setInternalCategory(controlled);
    } else if (urlCategory) {
      setInternalCategory(urlCategory);
    }
  }, [controlledSelectedCategory, controlledActiveCategory, urlCategory]);

  const currentCategory =
    controlledSelectedCategory ?? controlledActiveCategory ?? internalCategory;

  const handleSelectCategory = useCallback(
    (categoryId: string) => {
      setInternalCategory(categoryId);
      onSelectCategory?.(categoryId);
      onCategoryChange?.(categoryId);

      if (syncWithUrl && pathname && router) {
        const params = new URLSearchParams(
          searchParams ? searchParams.toString() : "",
        );
        if (categoryId === "all") {
          params.delete("category");
        } else {
          params.set("category", categoryId);
        }
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    },
    [
      onSelectCategory,
      onCategoryChange,
      syncWithUrl,
      pathname,
      router,
      searchParams,
    ],
  );

  const handleCategoryKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      let nextIndex: number | null = null;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % categories.length;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + categories.length) % categories.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = categories.length - 1;
      }

      if (nextIndex !== null) {
        const nextCat = categories[nextIndex];
        handleSelectCategory(nextCat.id);
        tabRefs.current[nextIndex]?.focus();
      }
    },
    [categories, handleSelectCategory],
  );

  const handlePillKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      let nextIndex: number | null = null;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % filters.length;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + filters.length) % filters.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = filters.length - 1;
      }

      if (nextIndex !== null) {
        pillRefs.current[nextIndex]?.focus();
      }
    },
    [filters],
  );

  // -------------------------------------------------------------------------
  // Derive decibel and wifi range from URL or controlled prop
  // -------------------------------------------------------------------------

  const urlDecibels = React.useMemo<[number, number] | null>(() => {
    if (!searchParams) return null;
    const minDb = searchParams.get("minDb");
    const maxDb = searchParams.get("maxDb");
    if (minDb !== null || maxDb !== null) {
      return [
        minDb
          ? Math.max(20, Math.min(100, Number(minDb)))
          : DEFAULT_DECIBEL_RANGE[0],
        maxDb
          ? Math.max(20, Math.min(100, Number(maxDb)))
          : DEFAULT_DECIBEL_RANGE[1],
      ];
    }
    return null;
  }, [searchParams]);

  const urlWifi = React.useMemo<[number, number] | null>(() => {
    if (!searchParams) return null;
    const minW = searchParams.get("minWifi");
    const maxW = searchParams.get("maxWifi");
    if (minW !== null || maxW !== null) {
      return [
        minW ? Math.max(0, Math.min(500, Number(minW))) : DEFAULT_WIFI_RANGE[0],
        maxW ? Math.max(0, Math.min(500, Number(maxW))) : DEFAULT_WIFI_RANGE[1],
      ];
    }
    return null;
  }, [searchParams]);

  const [internalDecibels, setInternalDecibels] = useState<[number, number]>(
    controlledDecibels ?? urlDecibels ?? DEFAULT_DECIBEL_RANGE,
  );
  const [internalWifi, setInternalWifi] = useState<[number, number]>(
    controlledWifi ?? urlWifi ?? DEFAULT_WIFI_RANGE,
  );

  useEffect(() => {
    if (controlledDecibels) {
      setInternalDecibels(controlledDecibels);
    } else if (urlDecibels) {
      setInternalDecibels(urlDecibels);
    }
  }, [controlledDecibels, urlDecibels]);

  useEffect(() => {
    if (controlledWifi) {
      setInternalWifi(controlledWifi);
    } else if (urlWifi) {
      setInternalWifi(urlWifi);
    }
  }, [controlledWifi, urlWifi]);

  // Check if custom ranges are active
  const hasCustomRangeActive = React.useMemo(() => {
    const isDbCustom =
      internalDecibels[0] !== DEFAULT_DECIBEL_RANGE[0] ||
      internalDecibels[1] !== DEFAULT_DECIBEL_RANGE[1] ||
      (searchParams &&
        (searchParams.has("minDb") || searchParams.has("maxDb")));
    const isWifiCustom =
      internalWifi[0] !== DEFAULT_WIFI_RANGE[0] ||
      internalWifi[1] !== DEFAULT_WIFI_RANGE[1] ||
      (searchParams &&
        (searchParams.has("minWifi") || searchParams.has("maxWifi")));
    return isDbCustom || isWifiCustom;
  }, [internalDecibels, internalWifi, searchParams]);

  // Handle outside click & escape key to dismiss popover
  useEffect(() => {
    if (!isPopoverOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsPopoverOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPopoverOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPopoverOpen]);

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

    updateScrollEdge();

    el.addEventListener("scroll", updateScrollEdge, { passive: true });
    window.addEventListener("resize", updateScrollEdge);

    return () => {
      el.removeEventListener("scroll", updateScrollEdge);
      window.removeEventListener("resize", updateScrollEdge);
    };
  }, [updateScrollEdge, filters]);

  // -------------------------------------------------------------------------
  // Toggle handler for amenity pills
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
  // Range filters Apply and Reset handlers
  // -------------------------------------------------------------------------

  const handleApplyRangeFilters = useCallback(() => {
    setIsPopoverOpen(false);
    onDecibelRangeChange?.(internalDecibels);
    onWifiSpeedRangeChange?.(internalWifi);

    if (syncWithUrl && pathname && router) {
      const params = new URLSearchParams(
        searchParams ? searchParams.toString() : "",
      );

      if (
        internalDecibels[0] !== DEFAULT_DECIBEL_RANGE[0] ||
        internalDecibels[1] !== DEFAULT_DECIBEL_RANGE[1]
      ) {
        params.set("minDb", String(internalDecibels[0]));
        params.set("maxDb", String(internalDecibels[1]));
      } else {
        params.delete("minDb");
        params.delete("maxDb");
      }

      if (
        internalWifi[0] !== DEFAULT_WIFI_RANGE[0] ||
        internalWifi[1] !== DEFAULT_WIFI_RANGE[1]
      ) {
        params.set("minWifi", String(internalWifi[0]));
        params.set("maxWifi", String(internalWifi[1]));
      } else {
        params.delete("minWifi");
        params.delete("maxWifi");
      }

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [
    internalDecibels,
    internalWifi,
    onDecibelRangeChange,
    onWifiSpeedRangeChange,
    syncWithUrl,
    pathname,
    router,
    searchParams,
  ]);

  const handleResetRangeFilters = useCallback(() => {
    setInternalDecibels(DEFAULT_DECIBEL_RANGE);
    setInternalWifi(DEFAULT_WIFI_RANGE);
    onDecibelRangeChange?.(DEFAULT_DECIBEL_RANGE);
    onWifiSpeedRangeChange?.(DEFAULT_WIFI_RANGE);

    if (syncWithUrl && pathname && router) {
      const params = new URLSearchParams(
        searchParams ? searchParams.toString() : "",
      );
      params.delete("minDb");
      params.delete("maxDb");
      params.delete("minWifi");
      params.delete("maxWifi");

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [
    onDecibelRangeChange,
    onWifiSpeedRangeChange,
    syncWithUrl,
    pathname,
    router,
    searchParams,
  ]);

  // -------------------------------------------------------------------------
  // Render — return null if filters list is explicitly empty
  // -------------------------------------------------------------------------

  if (filters.length === 0) return null;

  const maskImage = buildMaskImage(scrollEdge);

  return (
    <div
      data-testid={testId}
      className={cn("relative w-full space-y-2", className)}
    >
      {/* Category Tabs with Framer Motion layoutId sliding pill indicator */}
      {showCategoryTabs && categories.length > 0 && (
        <LayoutGroup id="venue-filter-categories">
          <div
            role="tablist"
            aria-label="Venue categories"
            data-testid="venue-category-tabs"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 px-1 scroll-smooth touch-pan-x"
          >
            {categories.map((cat, index) => {
              const isSelected = currentCategory === cat.id;
              const Icon = cat.icon;

              return (
                <button
                  key={cat.id}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`venue-category-tab-${cat.id}`}
                  aria-selected={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  data-testid={`venue-category-tab-${cat.id}`}
                  data-selected={isSelected}
                  onClick={() => handleSelectCategory(cat.id)}
                  onKeyDown={(e) => handleCategoryKeyDown(e, index)}
                  className={cn(
                    "relative inline-flex items-center justify-center gap-1.5",
                    "min-h-[40px] sm:min-h-[44px] px-4 py-1.5 rounded-full",
                    "text-xs font-semibold shrink-0 select-none",
                    "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
                    isSelected
                      ? "text-white"
                      : "text-zinc-600 hover:text-zinc-900 bg-zinc-100/80 hover:bg-zinc-200/80 border border-zinc-200/80 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700/80",
                  )}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="activeFilterPill"
                      transition={{
                        type: "spring",
                        stiffness: 450,
                        damping: 30,
                      }}
                      className="absolute inset-0 bg-blue-600 rounded-full shadow-sm"
                      data-testid="active-filter-pill-indicator"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                    <span>{cat.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>
      )}

      {/* Amenity Filter Row */}
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
          {/* Custom Ambient Decibel & WiFi Speed Range Filter Trigger */}
          {showCustomRangeFilters && (
            <button
              ref={triggerRef}
              type="button"
              role="button"
              aria-haspopup="dialog"
              aria-expanded={isPopoverOpen}
              data-testid="venue-filter-popover-trigger"
              data-selected={hasCustomRangeActive}
              onClick={() => setIsPopoverOpen((prev) => !prev)}
              className={cn(
                "inline-flex items-center justify-center gap-1.5",
                "min-h-[44px] px-3 rounded-full",
                "text-xs font-semibold shrink-0 select-none",
                "transition-all active:scale-95 border",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
                hasCustomRangeActive || isPopoverOpen
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm hover:bg-blue-700 dark:bg-blue-600 dark:border-blue-500"
                  : "bg-zinc-100 hover:bg-zinc-200/80 text-zinc-700 border-zinc-200/80 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700/80",
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Noise &amp; Wi-Fi</span>
              {hasCustomRangeActive && (
                <span
                  data-testid="venue-filter-popover-active-indicator"
                  className="h-1.5 w-1.5 rounded-full bg-white dark:bg-cyan-300"
                />
              )}
            </button>
          )}

          {filters.map((item, index) => {
            const isSelected = activeSet.has(item.id);
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                ref={(el) => {
                  pillRefs.current[index] = el;
                }}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                data-testid={`venue-filter-pill-${item.id}`}
                data-selected={isSelected}
                onClick={() => handleToggle(item)}
                onKeyDown={(e) => handlePillKeyDown(e, index)}
                className={cn(
                  "relative inline-flex items-center justify-center gap-1.5",
                  "min-h-[44px] px-3 rounded-full",
                  "text-xs font-semibold shrink-0 select-none",
                  "transition-all active:scale-95 border",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
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

      {/* Custom Range Filters Popover */}
      {showCustomRangeFilters && isPopoverOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="true"
          aria-label="Custom ambient noise and WiFi speed filters"
          data-testid="venue-filter-popover"
          className={cn(
            "absolute left-0 top-full mt-2 z-50",
            "w-full sm:w-[420px] max-w-[calc(100vw-2rem)]",
            "rounded-2xl border border-zinc-200 dark:border-zinc-800",
            "bg-white dark:bg-zinc-900 p-5 shadow-2xl",
            "animate-in fade-in duration-150",
          )}
        >
          {/* Popover Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Acoustic &amp; Connectivity Filters
              </h3>
            </div>
            <button
              type="button"
              data-testid="close-filter-popover-button"
              onClick={() => setIsPopoverOpen(false)}
              className="rounded-lg p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
              aria-label="Close custom filters popover"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-6">
            {/* Decibel Range Slider Section */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Volume2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Ambient Noise Range
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-2">
                Target acoustic levels from quiet libraries to vibrant cafes.
              </p>
              <DualRangeSlider
                min={20}
                max={100}
                step={1}
                value={internalDecibels}
                onChange={setInternalDecibels}
                formatValue={(v) => `${v} dB`}
                minThumbLabel="Minimum decibels"
                maxThumbLabel="Maximum decibels"
                data-testid="decibel-range-slider"
              />
            </div>

            {/* WiFi Speed Range Slider Section */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Wifi className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Wi-Fi Download Speed
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-2">
                Verified connectivity speed from light browsing to 4K calls.
              </p>
              <DualRangeSlider
                min={0}
                max={500}
                step={5}
                value={internalWifi}
                onChange={setInternalWifi}
                formatValue={(v) => `${v} Mbps`}
                minThumbLabel="Minimum WiFi speed"
                maxThumbLabel="Maximum WiFi speed"
                data-testid="wifi-range-slider"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 pt-4 mt-6">
            <button
              type="button"
              data-testid="reset-range-filters-button"
              onClick={handleResetRangeFilters}
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Defaults
            </button>

            <button
              type="button"
              data-testid="apply-range-filters-button"
              onClick={handleApplyRangeFilters}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default VenueFilterBar;
