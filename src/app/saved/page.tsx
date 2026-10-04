"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bookmark, Download, Heart, Search, X } from "lucide-react";
import { useSavedVenues, type SavedVenue } from "@/hooks/useSavedVenues";
import { SavedVenueCard, TagFilter } from "@/components/saved-venues";
import { EmptyState } from "@/components/ui/EmptyState";
import { SavedVenueCardSkeleton } from "@/components/ui/skeleton";

function exportCollectionAsCSV(favorites: SavedVenue[]) {
  const headers = [
    "Name",
    "Category",
    "Address",
    "WiFi Quality",
    "Noise Level",
    "Rating",
    "Tags",
  ];

  const escape = (value: string | null | undefined) => {
    if (value == null) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = favorites.map((fav) => [
    escape(fav.venue.name),
    escape(fav.venue.category),
    escape(fav.venue.address),
    escape(fav.venue.wifiQuality != null ? String(fav.venue.wifiQuality) : null),
    escape(fav.venue.noiseLevel),
    escape(fav.venue.rating != null ? String(fav.venue.rating) : null),
    escape(fav.tags.map((t) => t.name).join("; ")),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worksphere-saved-venues.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function exportCollectionAsGeoJSON(favorites: SavedVenue[]) {
  const geojson = {
    type: "FeatureCollection",
    features: favorites
      .filter((fav) => {
        const { latitude, longitude } = fav.venue;
        return (
          typeof latitude === "number" &&
          typeof longitude === "number" &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180 &&
          !(latitude === 0 && longitude === 0)
        );
      })
      .map((fav) => ({
        type: "Feature",
        id: fav.id,
        geometry: {
          type: "Point",
          coordinates: [fav.venue.longitude, fav.venue.latitude],
        },
        properties: {
          venueId: fav.venue.id,
          name: fav.venue.name,
          category: fav.venue.category,
          address: fav.venue.address ?? null,
          rating: fav.venue.rating ?? null,
          tags: fav.tags.map((t) => t.name),
          notes: fav.notes ?? null,
          wifiQuality: fav.venue.wifiQuality ?? null,
          wifiSpeed: fav.venue.wifiSpeed ?? null,
          hasOutlets: Boolean(fav.venue.hasOutlets),
          noiseLevel: fav.venue.noiseLevel ?? null,
        },
      })),
  };

  const blob = new Blob([JSON.stringify(geojson, null, 2)], {
    type: "application/geo+json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worksphere-saved-venues.geojson";
  link.click();
  URL.revokeObjectURL(url);
}

function exportCollectionAsKML(favorites: SavedVenue[]) {
  const placemarks = favorites
    .filter((fav) => {
      const { latitude, longitude } = fav.venue;
      return (
        typeof latitude === "number" &&
        typeof longitude === "number" &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        !(latitude === 0 && longitude === 0)
      );
    })
    .map((fav) => {
      const tags = fav.tags.map((t) => t.name).join(", ");
      const desc = [
        `Address: ${fav.venue.address || "N/A"}`,
        `Category: ${fav.venue.category || "N/A"}`,
        `Rating: ${fav.venue.rating ?? "N/A"}`,
        `Tags: ${tags || "None"}`,
        fav.notes ? `Notes: ${fav.notes}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      return [
        "    <Placemark>",
        `      <name>${fav.venue.name}</name>`,
        `      <description>${desc}</description>`,
        "      <Point>",
        `        <coordinates>${fav.venue.longitude},${fav.venue.latitude},0</coordinates>`,
        "      </Point>",
        "    </Placemark>",
      ].join("\n");
    });

  const kml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "  <Document>",
    "    <name>WorkSphere Saved Venues</name>",
    ...placemarks,
    "  </Document>",
    "</kml>",
  ].join("\n");

  const blob = new Blob([kml], {
    type: "application/vnd.google-earth.kml+xml;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worksphere-saved-venues.kml";
  link.click();
  URL.revokeObjectURL(url);
}

export default function SavedVenuesPage() {
  const {
    favorites,
    loading,
    error,
    allTags,
    updateNotes,
    addTag,
    updateTag,
    deleteTag,
    removeFavorite,
  } = useSavedVenues();

  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredFavorites = useMemo(() => {
    let result = favorites;

    if (selectedTagIds.length > 0) {
      result = result.filter((f) =>
        f.tags.some((t) => selectedTagIds.includes(t.id)),
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.venue.name.toLowerCase().includes(q) ||
          f.venue.address?.toLowerCase().includes(q) ||
          f.notes?.toLowerCase().includes(q) ||
          f.tags.some((t) => t.name.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [favorites, selectedTagIds, searchQuery]);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSearchQuery("");
  }, []);

  const hasActiveFilters =
    selectedTagIds.length > 0 || searchQuery.trim().length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-[1200px] mx-auto p-4 sm:p-6 lg:p-8 pt-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/ai"
              className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
              aria-label="Go back to map"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                <Bookmark className="w-6 h-6 accent-text" />
                Saved Venues
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Your bookmarked workspaces with notes and tags.
              </p>
            </div>
          </div>

          {!loading && favorites.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => exportCollectionAsGeoJSON(favorites)}
                className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
                aria-label="Download saved venues as GeoJSON"
              >
                <Download className="w-4 h-4" />
                Download GeoJSON
              </button>
              <button
                type="button"
                onClick={() => exportCollectionAsKML(favorites)}
                className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
                aria-label="Download saved venues as KML"
              >
                <Download className="w-4 h-4" />
                Download KML
              </button>
              <button
                type="button"
                onClick={() => exportCollectionAsCSV(favorites)}
                className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
                aria-label="Export saved venues as CSV"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>
          )}
        </div>

        {/* Filters */}
        {!loading && favorites.length > 0 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
            {/* Search */}
            <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search venues, notes, tags..."
                className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm outline-none focus:border-[var(--primary-accent)] transition-colors text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
                aria-label="Search saved venues"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Tag Filter */}
            <TagFilter
              allTags={allTags}
              selectedTagIds={selectedTagIds}
              onToggleTag={toggleTag}
              onClear={() => setSelectedTagIds([])}
            />

            {/* Clear all */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
                aria-label="Clear all filters"
              >
                <X className="w-3.5 h-3.5" />
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Active filter badges - mobile */}
        {!loading && hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5 mb-4 sm:hidden">
            {selectedTagIds.map((tagId) => {
              const tag = allTags.find((t) => t.id === tagId);
              if (!tag) return null;
              return (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                  }}
                >
                  {tag.name}
                  <button
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className="ml-0.5 hover:bg-black/10 dark:hover:bg-white/20 rounded-full p-0.5"
                    aria-label={`Remove filter: ${tag.name}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SavedVenueCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="text-center p-16">
            <p className="text-red-500 dark:text-red-400 mb-4">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 accent-bg hover:opacity-90 text-white rounded-xl text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
            >
              Try Again
            </button>
          </div>
        ) : favorites.length === 0 ? (
          <section
            role="region"
            aria-label="Empty saved workspaces"
            className="flex flex-col items-center justify-center p-8 sm:p-12 text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl shadow-sm max-w-lg mx-auto"
          >
            <div
              className="w-16 h-16 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 flex items-center justify-center mb-4"
              aria-hidden="true"
            >
              <Heart className="w-8 h-8 fill-current" />
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
              No saved workspaces yet
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mb-6 leading-relaxed">
              Explore nearby cafes, coworking spaces, and quiet libraries and
              tap the heart icon to save them for quick access.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
              aria-label="Explore Workspaces"
            >
              Explore Workspaces
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </section>
        ) : filteredFavorites.length === 0 ? (
          <div className="text-center p-16">
            <EmptyState
              illustration="search"
              message="No venues match your filters"
              description="Try adjusting your search or tag filters."
              action={
                <button
                  type="button"
                  onClick={clearFilters}
                  className="px-4 py-2 text-sm font-medium accent-text accent-bg-hover accent-bg-dark-20 rounded-xl transition-colors"
                >
                  Clear all filters
                </button>
              }
            />
          </div>
        ) : (
          <div
            data-testid="venue-discovery-grid"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {filteredFavorites.map((fav) => (
              <SavedVenueCard
                key={fav.id}
                favorite={fav}
                onUpdateNotes={updateNotes}
                onAddTag={addTag}
                onUpdateTag={updateTag}
                onDeleteTag={deleteTag}
                onRemoveFavorite={removeFavorite}
              />
            ))}
          </div>
        )}

        {/* Results count */}
        {!loading && favorites.length > 0 && (
          <div className="mt-6 text-center">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Showing {filteredFavorites.length} of {favorites.length} saved
              venues
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
