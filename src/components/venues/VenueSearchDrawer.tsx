"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Search,
  SlidersHorizontal,
  RotateCcw,
  Check,
  Bookmark,
  BookmarkPlus,
  Trash2,
  Sparkles,
} from "lucide-react";
import { usePlatformModifier } from "@/hooks/usePlatformModifier";
import { KeyboardShortcutBadge } from "@/components/ui/KeyboardShortcutBadge";
import {
  loadFilterPresets,
  saveFilterPreset,
  deleteFilterPreset,
  FilterPreset,
} from "@/lib/venueFilterPresets";

export interface VenueSearchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  searchText?: string;
  onSearchChange?: (text: string) => void;
  selectedAmenities?: string[];
  onAmenitiesChange?: (amenities: string[]) => void;
  noiseLevel?: string;
  onNoiseLevelChange?: (level: string) => void;
  priceRange?: string;
  onPriceRangeChange?: (price: string) => void;
  category?: string;
  onCategoryChange?: (category: string) => void;
  maxDistance?: number;
  onMaxDistanceChange?: (distance: number) => void;
  onClearFilters?: () => void;
  onApplyFilters?: () => void;
}

export const AMENITIES_LIST = [
  { id: "wifi", label: "High-Speed WiFi" },
  { id: "outlets", label: "Power Outlets" },
  { id: "ergonomic", label: "Ergonomic Setup" },
  { id: "quiet", label: "Quiet Zone" },
  { id: "phonebooths", label: "Phone Booths" },
];

export const CATEGORIES_LIST = [
  { id: "all", label: "All Types" },
  { id: "cafe", label: "Cafes" },
  { id: "coworking", label: "Coworking" },
  { id: "library", label: "Libraries" },
];

export const DISTANCE_OPTIONS = [
  { id: 0, label: "Any Distance" },
  { id: 0.5, label: "500m" },
  { id: 1, label: "1km" },
  { id: 3, label: "3km" },
  { id: 5, label: "5km" },
];


export const NOISE_LEVELS = [
  { id: "all", label: "Any Noise" },
  { id: "quiet", label: "Quiet" },
  { id: "moderate", label: "Moderate" },
  { id: "loud", label: "Lively" },
];

export const PRICE_RANGES = [
  { id: "all", label: "Any Price" },
  { id: "$", label: "$" },
  { id: "$$", label: "$$" },
  { id: "$$$", label: "$$$" },
];

/** Table/desk size filter — matches the tableSize field on Venue */
export const TABLE_SIZES = [
  { id: "all", label: "Any Table Size" },
  { id: "small",  label: "Small (cafe table, 1–2 people)" },
  { id: "medium", label: "Medium (4-person table)" },
  { id: "large",  label: "Large (6-8 person desk)" },
  { id: "xl",     label: "XL (standing desk / monitor setup)" },
];

/** Equipment loadout preset — matches the equipmentLoadout field on Venue */
export const EQUIPMENT_LOADOUTS = [
  { id: "all",      label: "Any Loadout" },
  { id: "minimal",  label: "Minimal (laptop only)" },
  { id: "standard", label: "Standard (laptop + mouse)" },
  { id: "heavy",    label: "Heavy (dual monitor, dock)" },
];

export function VenueSearchDrawer({
  isOpen,
  onClose,
  searchText: externalSearchText,
  onSearchChange,
  selectedAmenities: externalAmenities,
  onAmenitiesChange,
  noiseLevel: externalNoiseLevel,
  onNoiseLevelChange,
  priceRange: externalPriceRange,
  onPriceRangeChange,
  category: externalCategory,
  onCategoryChange,
  maxDistance: externalMaxDistance,
  onMaxDistanceChange,
  onClearFilters,
  onApplyFilters,
}: VenueSearchDrawerProps) {
  // Internal state for self-contained or fallback usage
  const [internalSearch, setInternalSearch] = useState("");
  const [internalAmenities, setInternalAmenities] = useState<string[]>([]);
  const [internalNoise, setInternalNoise] = useState("all");
  const [internalPrice, setInternalPrice] = useState("all");
  const [internalCategory, setInternalCategory] = useState("all");
  const [internalDistance, setInternalDistance] = useState(0);

  // Preset management state
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");

  useEffect(() => {
    setPresets(loadFilterPresets());
  }, []);

  const { formatShortcut, getAriaKeyshortcuts } = usePlatformModifier();

  const search = externalSearchText ?? internalSearch;
  const amenities = externalAmenities ?? internalAmenities;
  const noise = externalNoiseLevel ?? internalNoise;
  const price = externalPriceRange ?? internalPrice;
  const cat = externalCategory ?? internalCategory;
  const distance = externalMaxDistance ?? internalDistance;

  const hasActiveFilters =
    search.trim() !== "" ||
    amenities.length > 0 ||
    noise !== "all" ||
    price !== "all" ||
    cat !== "all" ||
    distance > 0;

  const activeFilterCount =
    (search.trim() !== "" ? 1 : 0) +
    amenities.length +
    (noise !== "all" ? 1 : 0) +
    (price !== "all" ? 1 : 0) +
    (cat !== "all" ? 1 : 0) +
    (distance > 0 ? 1 : 0);

  const handleSearchInput = (val: string) => {
    setActivePresetId(null);
    if (onSearchChange) onSearchChange(val);
    else setInternalSearch(val);
  };

  const handleToggleAmenity = (amenityId: string) => {
    setActivePresetId(null);
    const next = amenities.includes(amenityId)
      ? amenities.filter((a) => a !== amenityId)
      : [...amenities, amenityId];
    if (onAmenitiesChange) onAmenitiesChange(next);
    else setInternalAmenities(next);
  };

  const handleNoiseChange = (val: string) => {
    setActivePresetId(null);
    if (onNoiseLevelChange) onNoiseLevelChange(val);
    else setInternalNoise(val);
  };

  const handlePriceChange = (val: string) => {
    setActivePresetId(null);
    if (onPriceRangeChange) onPriceRangeChange(val);
    else setInternalPrice(val);
  };

  const handleCategoryChange = (val: string) => {
    setActivePresetId(null);
    if (onCategoryChange) onCategoryChange(val);
    else setInternalCategory(val);
  };

  const handleDistanceChange = (val: number) => {
    setActivePresetId(null);
    if (onMaxDistanceChange) onMaxDistanceChange(val);
    else setInternalDistance(val);
  };

  const handleApplyPreset = (preset: FilterPreset) => {
    setActivePresetId(preset.id);
    const {
      searchText = "",
      amenities: pAmenities,
      noiseLevel: pNoise,
      priceRange: pPrice,
      category: pCat,
      maxDistance: pDist,
    } = preset.filters;

    if (onSearchChange) onSearchChange(searchText);
    else setInternalSearch(searchText);

    if (onAmenitiesChange) onAmenitiesChange([...pAmenities]);
    else setInternalAmenities([...pAmenities]);

    if (onNoiseLevelChange) onNoiseLevelChange(pNoise);
    else setInternalNoise(pNoise);

    if (onPriceRangeChange) onPriceRangeChange(pPrice);
    else setInternalPrice(pPrice);

    if (onCategoryChange) onCategoryChange(pCat);
    else setInternalCategory(pCat);

    if (onMaxDistanceChange) onMaxDistanceChange(pDist);
    else setInternalDistance(pDist);
  };

  const handleSavePreset = () => {
    if (!newPresetName.trim()) return;
    const updated = saveFilterPreset(newPresetName, {
      searchText: search,
      amenities,
      noiseLevel: noise,
      priceRange: price,
      category: cat,
      maxDistance: distance,
    });
    setPresets(updated);
    const created = updated[updated.length - 1];
    if (created) {
      setActivePresetId(created.id);
    }
    setNewPresetName("");
    setIsSavingPreset(false);
  };

  const handleDeletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = deleteFilterPreset(id);
    setPresets(updated);
    if (activePresetId === id) {
      setActivePresetId(null);
    }
  };

  const handleClear = () => {
    setActivePresetId(null);
    setIsSavingPreset(false);

    if (onSearchChange) onSearchChange("");
    setInternalSearch("");

    if (onAmenitiesChange) onAmenitiesChange([]);
    setInternalAmenities([]);

    if (onNoiseLevelChange) onNoiseLevelChange("all");
    setInternalNoise("all");

    if (onPriceRangeChange) onPriceRangeChange("all");
    setInternalPrice("all");

    if (onCategoryChange) onCategoryChange("all");
    setInternalCategory("all");

    if (onMaxDistanceChange) onMaxDistanceChange(0);
    setInternalDistance(0);

    if (onClearFilters) onClearFilters();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm transition-opacity"
      aria-modal="true"
      role="dialog"
      aria-label="Venue Search Filters"
    >
      {/* Backdrop click to close */}
      <div className="flex-1" onClick={onClose} />

      {/* Mobile Bottom Drawer Panel */}
      <div className="w-full max-h-[85vh] bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 rounded-t-[2rem] p-5 flex flex-col gap-5 overflow-y-auto shadow-2xl animate-in slide-in-from-bottom duration-200">
        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-blue-500" />
            <h3 className="text-base font-black uppercase tracking-tight text-zinc-900 dark:text-white">
              Search & Filter Venues
            </h3>
            {activeFilterCount > 0 && (
              <span
                data-testid="active-filter-badge"
                className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 animate-in zoom-in-75 duration-200"
              >
                {activeFilterCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                data-testid="header-clear-all-btn"
                onClick={handleClear}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all animate-in fade-in zoom-in-95 duration-200"
                aria-label="Clear all active filters"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Clear All</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Close search filters"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick & Saved Filter Presets */}
        <div className="space-y-2 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Quick Presets</span>
            </div>
            {!isSavingPreset ? (
              <button
                type="button"
                data-testid="open-save-preset-btn"
                onClick={() => setIsSavingPreset(true)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>Save Current as Preset</span>
              </button>
            ) : null}
          </div>

          {/* Inline Save Preset Form */}
          {isSavingPreset && (
            <div
              data-testid="save-preset-form"
              className="flex items-center gap-2 pt-1 pb-1 animate-in fade-in zoom-in-95 duration-150"
            >
              <input
                type="text"
                data-testid="preset-name-input"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSavePreset();
                  } else if (e.key === "Escape") {
                    setIsSavingPreset(false);
                  }
                }}
                placeholder="Preset name (e.g., Morning Coffee)..."
                autoFocus
                className="flex-1 px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                data-testid="confirm-save-preset-btn"
                onClick={handleSavePreset}
                disabled={!newPresetName.trim()}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
              >
                Save
              </button>
              <button
                type="button"
                data-testid="cancel-save-preset-btn"
                onClick={() => {
                  setIsSavingPreset(false);
                  setNewPresetName("");
                }}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                aria-label="Cancel saving preset"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Preset Buttons List */}
          <div className="flex flex-wrap gap-2 pt-1">
            {presets.map((preset) => {
              const isSelected = activePresetId === preset.id;
              return (
                <div
                  key={preset.id}
                  data-testid={`preset-item-${preset.id}`}
                  onClick={() => handleApplyPreset(preset)}
                  className={`group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer select-none ${
                    isSelected
                      ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20"
                      : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:border-blue-400/60"
                  }`}
                >
                  <Bookmark
                    className={`w-3 h-3 ${
                      isSelected ? "text-white fill-current" : "text-zinc-400"
                    }`}
                  />
                  <span>{preset.name}</span>
                  {!preset.isDefault && (
                    <button
                      type="button"
                      data-testid={`delete-preset-${preset.id}`}
                      onClick={(e) => handleDeletePreset(preset.id, e)}
                      className={`ml-1 p-0.5 rounded hover:bg-red-500 hover:text-white transition-colors ${
                        isSelected
                          ? "text-blue-200"
                          : "text-zinc-400 opacity-60 group-hover:opacity-100"
                      }`}
                      aria-label={`Delete preset ${preset.name}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Active Filters Bar (shown when any filter is modified) */}
        {hasActiveFilters && (
          <div
            data-testid="active-filters-bar"
            className="flex flex-wrap items-center gap-1.5 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 animate-in fade-in slide-in-from-top-2 duration-200"
          >
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mr-1">
              Active:
            </span>
            {search.trim() !== "" && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 animate-in zoom-in-95 duration-150">
                "{search}"
                <button
                  type="button"
                  data-testid="clear-search-chip"
                  onClick={() => handleSearchInput("")}
                  className="hover:text-rose-500 transition-colors"
                  aria-label="Remove search filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {cat !== "all" && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 animate-in zoom-in-95 duration-150">
                {CATEGORIES_LIST.find((c) => c.id === cat)?.label ?? cat}
                <button
                  type="button"
                  data-testid="clear-category-chip"
                  onClick={() => handleCategoryChange("all")}
                  className="hover:text-rose-500 transition-colors"
                  aria-label="Remove category filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {distance > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 animate-in zoom-in-95 duration-150">
                Within {DISTANCE_OPTIONS.find((d) => d.id === distance)?.label ?? distance}
                <button
                  type="button"
                  data-testid="clear-distance-chip"
                  onClick={() => handleDistanceChange(0)}
                  className="hover:text-rose-500 transition-colors"
                  aria-label="Remove distance filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {amenities.map((amenityId) => {
              const item = AMENITIES_LIST.find((a) => a.id === amenityId);
              return (
                <span
                  key={amenityId}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 animate-in zoom-in-95 duration-150"
                >
                  {item?.label ?? amenityId}
                  <button
                    type="button"
                    data-testid={`clear-amenity-chip-${amenityId}`}
                    onClick={() => handleToggleAmenity(amenityId)}
                    className="hover:text-rose-500 transition-colors"
                    aria-label={`Remove ${item?.label ?? amenityId} filter`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
            {noise !== "all" && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 animate-in zoom-in-95 duration-150">
                Noise: {NOISE_LEVELS.find((n) => n.id === noise)?.label ?? noise}
                <button
                  type="button"
                  data-testid="clear-noise-chip"
                  onClick={() => handleNoiseChange("all")}
                  className="hover:text-rose-500 transition-colors"
                  aria-label="Remove noise filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {price !== "all" && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 animate-in zoom-in-95 duration-150">
                Price: {price}
                <button
                  type="button"
                  data-testid="clear-price-chip"
                  onClick={() => handlePriceChange("all")}
                  className="hover:text-rose-500 transition-colors"
                  aria-label="Remove price filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <button
              type="button"
              data-testid="clear-all-filters-btn"
              onClick={handleClear}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Clear All Filters
            </button>
          </div>
        )}

        {/* Text Search Input */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Search Keyword
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              data-testid="search-input"
              value={search}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder="Search by venue name, street, or tag..."
              aria-label={`Search venues (${formatShortcut("K")})`}
              aria-keyshortcuts={getAriaKeyshortcuts("K")}
              title={`Search venues (${formatShortcut("K")})`}
              className="w-full pl-9 pr-16 py-2.5 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none hidden sm:flex items-center">
              <KeyboardShortcutBadge shortcut="K" size="xs" variant="subtle" />
            </div>
          </div>
        </div>

        {/* Category Filters */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Category
          </label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES_LIST.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`category-${item.id}`}
                onClick={() => handleCategoryChange(item.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  cat === item.id
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Distance Filter */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Within Distance
          </label>
          <div className="flex flex-wrap gap-2">
            {DISTANCE_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`distance-${item.id}`}
                onClick={() => handleDistanceChange(item.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  distance === item.id
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Amenity filter chips (#2177) */}
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Amenities & Features
          </label>
          <div className="flex flex-wrap gap-2">
            {AMENITIES_LIST.map((item) => {
              const isActive = amenities.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  id={`amenity-${item.id}`}
                  data-testid={`amenity-${item.id}`}
                  aria-pressed={isActive}
                  aria-label={item.label}
                  onClick={() => handleToggleAmenity(item.id)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ease-out origin-center ${
                    isActive
                      ? "scale-105 bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/25"
                      : "scale-100 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-400/60"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Noise Level */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Noise Level Preference
          </label>
          <div className="flex flex-wrap gap-2">
            {NOISE_LEVELS.map((item) => {
              const isSelected = noise === item.id;
              const ariaLabel =
                item.id === "all"
                  ? "Filter by Any Noise level"
                  : `Filter by ${item.label} spaces`;

              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`noise-${item.id}`}
                  aria-pressed={isSelected}
                  aria-label={ariaLabel}
                  onClick={() => handleNoiseChange(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleNoiseChange(item.id);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    isSelected
                      ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Price Range */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Price Range
          </label>
          <div className="flex flex-wrap gap-2">
            {PRICE_RANGES.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`price-${item.id}`}
                onClick={() => handlePriceChange(item.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  price === item.id
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          {hasActiveFilters && (
            <button
              type="button"
              data-testid="clear-filters-btn"
              onClick={handleClear}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all animate-in fade-in duration-200"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Filters</span>
            </button>
          )}
          <button
            type="button"
            data-testid="apply-filters-btn"
            onClick={() => {
              if (onApplyFilters) onApplyFilters();
              onClose();
            }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-all"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Apply Filters</span>
          </button>
        </div>
      </div>
    </div>
  );
}
