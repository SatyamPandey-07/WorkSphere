"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";

export type ViewMode = "map" | "list" | "card" | "chat";

export interface VenueFilterState {
  query: string;
  category: string;
  wifi: boolean;
  wifiSpeedBand?: "basic" | "fast" | "ultra" | "all";
  noiseLevel: "quiet" | "moderate" | "loud" | "all";
  quietHours: boolean;
  outlets: boolean;
  priceRange: "$" | "$$" | "$$$" | "all";
  amenities: string[];
  maxDistance: number;
  view: ViewMode;
}

export const DEFAULT_FILTER_STATE: VenueFilterState = {
  query: "",
  category: "all",
  wifi: false,
  wifiSpeedBand: "all",
  noiseLevel: "all",
  quietHours: false,
  outlets: false,
  priceRange: "all",
  amenities: [],
  maxDistance: 0,
  view: "list",
};

/**
 * Parses venue discovery filters from Next.js URLSearchParams.
 */
export function parseFiltersFromSearchParams(
  params: URLSearchParams | null,
): VenueFilterState {
  if (!params) return { ...DEFAULT_FILTER_STATE };

  const query = params.get("q") ?? params.get("query") ?? "";
  const category = params.get("category") ?? params.get("type") ?? "all";
  const wifi =
    params.get("wifi") === "true" || params.get("hasWifi") === "true";
  const rawBand =
    params.get("wifiSpeedBand") ?? params.get("wifiSpeed") ?? "all";
  const wifiSpeedBand = (["basic", "fast", "ultra", "all"] as const).includes(
    rawBand as "basic",
  )
    ? (rawBand as VenueFilterState["wifiSpeedBand"])
    : "all";
  const rawNoise =
    params.get("noise") ??
    params.get("noiseLevel") ??
    (params.get("quiet") === "true" ? "quiet" : "all");
  const noiseLevel = (["quiet", "moderate", "loud", "all"] as const).includes(
    rawNoise as "quiet",
  )
    ? (rawNoise as VenueFilterState["noiseLevel"])
    : "all";
  const quietHours = params.get("quietHours") === "true";
  const outlets =
    params.get("outlets") === "true" ||
    params.get("hasOutlets") === "true" ||
    params.get("power") === "true";
  const rawPrice =
    params.get("price") ?? params.get("priceRange") ?? "all";
  const priceRange = (["$", "$$", "$$$", "all"] as const).includes(
    rawPrice as "$",
  )
    ? (rawPrice as VenueFilterState["priceRange"])
    : "all";
  const rawDistance = Number(
    params.get("distance") ?? params.get("maxDistance") ?? 0,
  );
  const maxDistance =
    Number.isFinite(rawDistance) && rawDistance > 0 ? rawDistance : 0;

  let amenities: string[] = [];
  const rawAmenities = params.get("amenities") ?? params.get("filters");
  if (rawAmenities) {
    amenities = rawAmenities
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
  }
  if (wifi && !amenities.includes("wifi")) amenities.push("wifi");
  if (outlets && !amenities.includes("outlets")) amenities.push("outlets");
  if (noiseLevel === "quiet" && !amenities.includes("quiet")) amenities.push("quiet");

  const rawView = params.get("view")?.toLowerCase();
  const view: ViewMode =
    rawView === "map" || rawView === "list" || rawView === "card" || rawView === "chat"
      ? rawView
      : "list";

  return {
    query,
    category,
    wifi,
    wifiSpeedBand,
    noiseLevel,
    quietHours,
    outlets,
    priceRange,
    amenities: Array.from(new Set(amenities)),
    maxDistance,
    view,
  };
}

/**
 * Builds a query string representation of filter state without losing other query parameters.
 */
export function buildQueryStringWithFilters(
  currentParams: URLSearchParams | null,
  updates: Partial<VenueFilterState>,
): string {
  const params = new URLSearchParams(currentParams?.toString() ?? "");

  // Update or delete query
  if (updates.query !== undefined) {
    if (updates.query.trim()) {
      params.set("q", updates.query.trim());
      params.delete("query");
    } else {
      params.delete("q");
      params.delete("query");
    }
  }

  // Update or delete category
  if (updates.category !== undefined) {
    if (updates.category && updates.category !== "all") {
      params.set("category", updates.category);
    } else {
      params.delete("category");
      params.delete("type");
    }
  }

  // Update or delete wifi
  if (updates.wifi !== undefined) {
    if (updates.wifi) {
      params.set("wifi", "true");
    } else {
      params.delete("wifi");
      params.delete("hasWifi");
    }
  }

  // Update or delete wifi speed band
  if (updates.wifiSpeedBand !== undefined) {
    if (updates.wifiSpeedBand && updates.wifiSpeedBand !== "all") {
      params.set("wifiSpeedBand", updates.wifiSpeedBand);
    } else {
      params.delete("wifiSpeedBand");
      params.delete("wifiSpeed");
    }
  }

  // Update or delete noise level
  if (updates.noiseLevel !== undefined) {
    if (updates.noiseLevel && updates.noiseLevel !== "all") {
      params.set("noise", updates.noiseLevel);
    } else {
      params.delete("noise");
      params.delete("noiseLevel");
      params.delete("quiet");
    }
  }

  // Update or delete quiet hours
  if (updates.quietHours !== undefined) {
    if (updates.quietHours) {
      params.set("quietHours", "true");
    } else {
      params.delete("quietHours");
    }
  }

  // Update or delete outlets
  if (updates.outlets !== undefined) {
    if (updates.outlets) {
      params.set("outlets", "true");
    } else {
      params.delete("outlets");
      params.delete("hasOutlets");
      params.delete("power");
    }
  }

  // Update or delete price range
  if (updates.priceRange !== undefined) {
    if (updates.priceRange && updates.priceRange !== "all") {
      params.set("price", updates.priceRange);
    } else {
      params.delete("price");
      params.delete("priceRange");
    }
  }

  // Update or delete amenities
  if (updates.amenities !== undefined) {
    const valid = updates.amenities.filter(Boolean);
    if (valid.length > 0) {
      params.set("amenities", valid.join(","));
    } else {
      params.delete("amenities");
      params.delete("filters");
    }
  }

  // Update or delete max distance
  if (updates.maxDistance !== undefined) {
    if (updates.maxDistance > 0) {
      params.set("distance", updates.maxDistance.toString());
    } else {
      params.delete("distance");
      params.delete("maxDistance");
    }
  }

  // Update view mode
  if (updates.view !== undefined) {
    if (updates.view && updates.view !== "list") {
      params.set("view", updates.view);
    } else {
      params.delete("view");
    }
  }

  const result = params.toString();
  return result ? `?${result}` : "";
}

/**
 * Custom hook to synchronize and preserve venue filters and search state across Map and List views.
 */
export function useVenueFilterParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo(
    () => parseFiltersFromSearchParams(searchParams),
    [searchParams],
  );

  const updateFilters = useCallback(
    (
      updates: Partial<VenueFilterState>,
      options: { replace?: boolean } = { replace: false },
    ) => {
      const queryString = buildQueryStringWithFilters(searchParams, updates);
      const targetUrl = `${pathname || ""}${queryString}`;

      if (options.replace) {
        router.replace(targetUrl, { scroll: false });
      } else {
        router.push(targetUrl, { scroll: false });
      }
    },
    [searchParams, pathname, router],
  );

  /**
   * Switches view between 'map' and 'list' while strictly preserving all active query parameters.
   */
  const switchView = useCallback(
    (targetView: ViewMode) => {
      updateFilters({ view: targetView }, { replace: false });
    },
    [updateFilters],
  );

  /**
   * Generates a navigation href string for a target view mode preserving current filters.
   */
  const getViewHref = useCallback(
    (targetView: ViewMode): string => {
      const queryString = buildQueryStringWithFilters(searchParams, {
        view: targetView,
      });
      return `${pathname || ""}${queryString}`;
    },
    [searchParams, pathname],
  );

  const clearFilters = useCallback(() => {
    // Reset all filters but preserve current viewMode
    updateFilters(
      {
        query: "",
        category: "all",
        wifi: false,
        wifiSpeedBand: "all",
        noiseLevel: "all",
        quietHours: false,
        outlets: false,
        priceRange: "all",
        amenities: [],
        maxDistance: 0,
        view: filters.view,
      },
      { replace: false },
    );
  }, [filters.view, updateFilters]);

  return {
    filters,
    viewMode: filters.view,
    updateFilters,
    switchView,
    getViewHref,
    clearFilters,
    hasActiveFilters:
      filters.query.trim() !== "" ||
      filters.category !== "all" ||
      filters.wifi ||
      (filters.wifiSpeedBand !== "all" && Boolean(filters.wifiSpeedBand)) ||
      filters.noiseLevel !== "all" ||
      filters.quietHours ||
      filters.outlets ||
      filters.priceRange !== "all" ||
      filters.amenities.length > 0 ||
      filters.maxDistance > 0,
  };
}
