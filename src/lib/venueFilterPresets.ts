/**
 * Venue Filter Presets Module
 * Enables saving, loading, applying, and deleting search filter presets
 * backed by localStorage for quick venue discovery.
 */

export interface VenueFilterValues {
  searchText?: string;
  amenities: string[];
  noiseLevel: string;
  priceRange: string;
  category: string;
  maxDistance: number;
}

export interface FilterPreset {
  id: string;
  name: string;
  filters: VenueFilterValues;
  isDefault?: boolean;
  createdAt: number;
}

export const FILTER_PRESETS_STORAGE_KEY = "worksphere_venue_filter_presets";

export const DEFAULT_FILTER_PRESETS: FilterPreset[] = [
  {
    id: "preset-quiet-study",
    name: "Quiet Study",
    isDefault: true,
    createdAt: 1700000000000,
    filters: {
      searchText: "",
      amenities: ["wifi", "outlets", "quiet"],
      noiseLevel: "quiet",
      priceRange: "all",
      category: "library",
      maxDistance: 0,
    },
  },
  {
    id: "preset-cafe-work",
    name: "Cafe Vibe",
    isDefault: true,
    createdAt: 1700000000001,
    filters: {
      searchText: "",
      amenities: ["wifi", "outlets"],
      noiseLevel: "all",
      priceRange: "$$",
      category: "cafe",
      maxDistance: 3,
    },
  },
  {
    id: "preset-team-collab",
    name: "Team Collab",
    isDefault: true,
    createdAt: 1700000000002,
    filters: {
      searchText: "",
      amenities: ["wifi", "outlets", "phonebooths", "ergonomic"],
      noiseLevel: "moderate",
      priceRange: "all",
      category: "coworking",
      maxDistance: 5,
    },
  },
];

/**
 * Loads all available filter presets (built-in defaults + user-saved presets from localStorage).
 */
export function loadFilterPresets(): FilterPreset[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [...DEFAULT_FILTER_PRESETS];
  }

  try {
    const raw = window.localStorage.getItem(FILTER_PRESETS_STORAGE_KEY);
    if (!raw) {
      return [...DEFAULT_FILTER_PRESETS];
    }
    const customPresets: FilterPreset[] = JSON.parse(raw);
    if (!Array.isArray(customPresets)) {
      return [...DEFAULT_FILTER_PRESETS];
    }

    // Merge default presets with custom presets (filtering out corrupt entries)
    const validCustom = customPresets.filter(
      (p) => p && typeof p.id === "string" && typeof p.name === "string" && p.filters,
    );

    return [...DEFAULT_FILTER_PRESETS, ...validCustom];
  } catch (error) {
    console.warn("Failed to load filter presets from localStorage:", error);
    return [...DEFAULT_FILTER_PRESETS];
  }
}

/**
 * Saves a new custom filter preset to localStorage and returns the merged preset list.
 */
export function saveFilterPreset(name: string, filters: VenueFilterValues): FilterPreset[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [...DEFAULT_FILTER_PRESETS];
  }

  const trimmedName = name.trim() || "My Preset";
  const newPreset: FilterPreset = {
    id: `preset-custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmedName,
    filters: {
      searchText: filters.searchText?.trim() || "",
      amenities: [...(filters.amenities || [])],
      noiseLevel: filters.noiseLevel || "all",
      priceRange: filters.priceRange || "all",
      category: filters.category || "all",
      maxDistance: filters.maxDistance ?? 0,
    },
    isDefault: false,
    createdAt: Date.now(),
  };

  try {
    const raw = window.localStorage.getItem(FILTER_PRESETS_STORAGE_KEY);
    const existing: FilterPreset[] = raw ? JSON.parse(raw) : [];
    const updatedCustom = Array.isArray(existing) ? [...existing, newPreset] : [newPreset];
    window.localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(updatedCustom));
    return [...DEFAULT_FILTER_PRESETS, ...updatedCustom];
  } catch (error) {
    console.error("Failed to save filter preset to localStorage:", error);
    return loadFilterPresets();
  }
}

/**
 * Deletes a custom preset from localStorage by ID and returns the updated preset list.
 */
export function deleteFilterPreset(presetId: string): FilterPreset[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [...DEFAULT_FILTER_PRESETS];
  }

  try {
    const raw = window.localStorage.getItem(FILTER_PRESETS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_FILTER_PRESETS];
    const existing: FilterPreset[] = JSON.parse(raw);
    if (!Array.isArray(existing)) return [...DEFAULT_FILTER_PRESETS];

    const filtered = existing.filter((p) => p.id !== presetId);
    window.localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(filtered));
    return [...DEFAULT_FILTER_PRESETS, ...filtered];
  } catch (error) {
    console.error("Failed to delete filter preset from localStorage:", error);
    return loadFilterPresets();
  }
}
