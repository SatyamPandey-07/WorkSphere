/**
 * Venue Filter Presets Module
 * Enables saving, loading, applying, and deleting search filter presets
 * backed by localStorage for quick venue discovery.
 */

import { sanitizeCapacityInput } from "./filters";

export const MAX_PRESET_NAME_LENGTH = 50;
export const MAX_CUSTOM_PRESETS = 20;

export interface VenueFilterValues {
  searchText?: string;
  amenities: string[];
  noiseLevel: string;
  priceRange: string;
  category: string;
  maxDistance: number;
  minCapacity?: number;
  semanticWeight?: number;
  fullTextWeight?: number;
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

const DEFAULT_PRESET_IDS = new Set(DEFAULT_FILTER_PRESETS.map((p) => p.id));

function sanitizePresetFilters(raw?: Partial<VenueFilterValues> | null): VenueFilterValues {
  const safe = raw || {};
  const amenities = Array.isArray(safe.amenities)
    ? safe.amenities.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    : [];

  const maxDistance =
    typeof safe.maxDistance === "number" &&
    Number.isFinite(safe.maxDistance) &&
    safe.maxDistance >= 0
      ? safe.maxDistance
      : 0;

  const minCapacity =
    safe.minCapacity !== undefined && Number.isFinite(safe.minCapacity)
      ? sanitizeCapacityInput(safe.minCapacity)
      : undefined;

  const semanticWeight =
    typeof safe.semanticWeight === "number" && Number.isFinite(safe.semanticWeight)
      ? Math.max(0, Math.min(1, safe.semanticWeight))
      : undefined;

  const fullTextWeight =
    typeof safe.fullTextWeight === "number" && Number.isFinite(safe.fullTextWeight)
      ? Math.max(0, Math.min(1, safe.fullTextWeight))
      : undefined;

  return {
    searchText: typeof safe.searchText === "string" ? safe.searchText.trim() : "",
    amenities,
    noiseLevel: typeof safe.noiseLevel === "string" && safe.noiseLevel.trim() ? safe.noiseLevel.trim() : "all",
    priceRange: typeof safe.priceRange === "string" && safe.priceRange.trim() ? safe.priceRange.trim() : "all",
    category: typeof safe.category === "string" && safe.category.trim() ? safe.category.trim() : "all",
    maxDistance,
    minCapacity,
    semanticWeight,
    fullTextWeight,
  };
}

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
    const customPresets = JSON.parse(raw);
    if (!Array.isArray(customPresets)) {
      return [...DEFAULT_FILTER_PRESETS];
    }

    // Merge default presets with validated custom presets (filtering out corrupt entries and ID collisions)
    const validCustom: FilterPreset[] = [];
    for (const p of customPresets) {
      if (
        p &&
        typeof p === "object" &&
        typeof p.id === "string" &&
        p.id.trim() &&
        !DEFAULT_PRESET_IDS.has(p.id) &&
        typeof p.name === "string" &&
        p.name.trim() &&
        p.filters &&
        typeof p.filters === "object"
      ) {
        validCustom.push({
          id: p.id.trim(),
          name: p.name.trim().slice(0, MAX_PRESET_NAME_LENGTH),
          filters: sanitizePresetFilters(p.filters),
          isDefault: false,
          createdAt: typeof p.createdAt === "number" && Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
        });
      }
    }

    return [...DEFAULT_FILTER_PRESETS, ...validCustom];
  } catch (error) {
    console.warn("Failed to load filter presets from localStorage:", error);
    return [...DEFAULT_FILTER_PRESETS];
  }
}

/**
 * Saves a new custom filter preset to localStorage and returns the merged preset list.
 */
export function saveFilterPreset(name: string, filters?: VenueFilterValues | null): FilterPreset[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [...DEFAULT_FILTER_PRESETS];
  }

  const trimmedName =
    typeof name === "string"
      ? name.trim().slice(0, MAX_PRESET_NAME_LENGTH) || "My Preset"
      : "My Preset";

  const sanitizedFilters = sanitizePresetFilters(filters);

  const newPreset: FilterPreset = {
    id: `preset-custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmedName,
    filters: sanitizedFilters,
    isDefault: false,
    createdAt: Date.now(),
  };

  try {
    const raw = window.localStorage.getItem(FILTER_PRESETS_STORAGE_KEY);
    let existing: FilterPreset[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          existing = parsed.filter(
            (p) =>
              p &&
              typeof p === "object" &&
              typeof p.id === "string" &&
              !DEFAULT_PRESET_IDS.has(p.id),
          );
        }
      } catch {
        existing = [];
      }
    }

    // Check if preset with identical case-insensitive name exists; update in place if so
    const existingIndex = existing.findIndex(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    let updatedCustom: FilterPreset[];
    if (existingIndex !== -1) {
      updatedCustom = [...existing];
      updatedCustom[existingIndex] = {
        ...newPreset,
        id: existing[existingIndex].id,
      };
    } else {
      updatedCustom = [...existing, newPreset].slice(-MAX_CUSTOM_PRESETS);
    }

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

  if (!presetId || typeof presetId !== "string" || DEFAULT_PRESET_IDS.has(presetId)) {
    return loadFilterPresets();
  }

  try {
    const raw = window.localStorage.getItem(FILTER_PRESETS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_FILTER_PRESETS];
    let existing: FilterPreset[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      return [...DEFAULT_FILTER_PRESETS];
    }

    const filtered = existing.filter((p) => p && p.id !== presetId);
    window.localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(filtered));
    return [...DEFAULT_FILTER_PRESETS, ...filtered];
  } catch (error) {
    console.error("Failed to delete filter preset from localStorage:", error);
    return loadFilterPresets();
  }
}
