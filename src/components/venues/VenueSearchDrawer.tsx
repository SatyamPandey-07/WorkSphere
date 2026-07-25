"use client";

import React, { useState } from "react";
import { X, Search, SlidersHorizontal, RotateCcw, Check } from "lucide-react";

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
  onClearFilters,
  onApplyFilters,
}: VenueSearchDrawerProps) {
  // Internal state for self-contained or fallback usage
  const [internalSearch, setInternalSearch] = useState("");
  const [internalAmenities, setInternalAmenities] = useState<string[]>([]);
  const [internalNoise, setInternalNoise] = useState("all");
  const [internalPrice, setInternalPrice] = useState("all");
  const [internalCategory, setInternalCategory] = useState("all");

  const search = externalSearchText ?? internalSearch;
  const amenities = externalAmenities ?? internalAmenities;
  const noise = externalNoiseLevel ?? internalNoise;
  const price = externalPriceRange ?? internalPrice;
  const cat = externalCategory ?? internalCategory;

  const handleSearchInput = (val: string) => {
    if (onSearchChange) onSearchChange(val);
    else setInternalSearch(val);
  };

  const handleToggleAmenity = (amenityId: string) => {
    const next = amenities.includes(amenityId)
      ? amenities.filter((a) => a !== amenityId)
      : [...amenities, amenityId];
    if (onAmenitiesChange) onAmenitiesChange(next);
    else setInternalAmenities(next);
  };

  const handleNoiseChange = (val: string) => {
    if (onNoiseLevelChange) onNoiseLevelChange(val);
    else setInternalNoise(val);
  };

  const handlePriceChange = (val: string) => {
    if (onPriceRangeChange) onPriceRangeChange(val);
    else setInternalPrice(val);
  };

  const handleCategoryChange = (val: string) => {
    if (onCategoryChange) onCategoryChange(val);
    else setInternalCategory(val);
  };

  const handleClear = () => {
    // Reset all filter state parameters simultaneously
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
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close search filters"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
              className="w-full pl-9 pr-4 py-2.5 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
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

        {/* Amenity Checkboxes */}
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Amenities & Features
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {AMENITIES_LIST.map((item) => {
              const isChecked = amenities.includes(item.id);
              return (
                <label
                  key={item.id}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                    isChecked
                      ? "bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-300"
                      : "bg-zinc-50 dark:bg-zinc-950/60 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    id={`amenity-${item.id}`}
                    data-testid={`amenity-${item.id}`}
                    checked={isChecked}
                    onChange={() => handleToggleAmenity(item.id)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-zinc-300 dark:border-zinc-700"
                  />
                  <span>{item.label}</span>
                </label>
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
            {NOISE_LEVELS.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`noise-${item.id}`}
                onClick={() => handleNoiseChange(item.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  noise === item.id
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                }`}
              >
                {item.label}
              </button>
            ))}
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
          <button
            type="button"
            data-testid="clear-filters-btn"
            onClick={handleClear}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear Filters</span>
          </button>
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
