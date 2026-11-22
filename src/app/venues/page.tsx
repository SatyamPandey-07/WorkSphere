"use client";

import React from "react";
import { VenueFilterBar } from "@/components/venues/VenueFilterBar";
import { SplitPaneWorkspace } from "@/components/venues/SplitPaneWorkspace";
import { useVenueFilterParams } from "@/hooks/useVenueFilterParams";

const demoVenues = [
  {
    id: 1,
    name: "WorkSphere Hub #1 - Downtown Core",
    category: "coworking",
    noise: "42 dB • Quiet",
    description:
      "High-speed fiber optics, ergonomic standing desks, and soundproof pod access.",
    distance: "450m away",
    desks: 12,
    amenities: ["wifi", "outlets", "quiet", "wheelchair"],
  },
  {
    id: 2,
    name: "WorkSphere Cafe #2 - Riverside",
    category: "cafe",
    noise: "51 dB • Moderate",
    description: "Specialty coffee, outdoor seating, and shared work tables.",
    distance: "700m away",
    desks: 8,
    amenities: ["wifi", "coffee", "outdoor"],
  },
  {
    id: 3,
    name: "WorkSphere Library #3 - Central",
    category: "library",
    noise: "35 dB • Quiet",
    description: "Quiet study desks, accessible entry, and reliable Wi-Fi.",
    distance: "900m away",
    desks: 20,
    amenities: ["wifi", "outlets", "quiet", "wheelchair"],
  },
  {
    id: 4,
    name: "WorkSphere Cafe #4 - Market Street",
    category: "cafe",
    noise: "48 dB • Moderate",
    description: "Pour-over coffee, patio tables, and plenty of power outlets.",
    distance: "1.1km away",
    desks: 6,
    amenities: ["wifi", "outlets", "coffee", "outdoor"],
  },
  {
    id: 5,
    name: "WorkSphere Hub #5 - Innovation Park",
    category: "coworking",
    noise: "40 dB • Quiet",
    description:
      "Dedicated quiet zones, power at every desk, and step-free access.",
    distance: "1.4km away",
    desks: 16,
    amenities: ["wifi", "outlets", "quiet", "wheelchair"],
  },
];

export default function VenuesDiscoveryPage() {
  const { filters, updateFilters } = useVenueFilterParams();
  const selectedCategory = filters.category;
  const selectedFilters = filters.amenities;

  const filteredVenues = demoVenues.filter((venue) => {
    const categoryMatches =
      selectedCategory === "all" || venue.category === selectedCategory;
    const amenitiesMatch = selectedFilters.every((filter) =>
      venue.amenities.includes(filter),
    );
    return categoryMatches && amenitiesMatch;
  });

  const leftFeed = (
    <div className="p-6 space-y-4 h-full overflow-y-auto bg-slate-950 border-r border-slate-900">
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-slate-100">
          Coworking Discovery Feed
        </h1>
        <p className="text-xs text-slate-400">
          Explore verified spaces, acoustic ratings, and real-time mesh
          occupancy.
        </p>
      </div>

      <VenueFilterBar
        selectedCategory={selectedCategory}
        onSelectCategory={(category) => updateFilters({ category })}
        selectedFilters={selectedFilters}
        onToggleFilter={(filterId, active) => {
          const nextFilters = active
            ? [...selectedFilters, filterId]
            : selectedFilters.filter((filter) => filter !== filterId);
          updateFilters({ amenities: Array.from(new Set(nextFilters)) });
        }}
        resultCount={filteredVenues.length}
        announcementDebounceMs={250}
        syncWithUrl={false}
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
      />

      <div className="space-y-3" data-testid="venue-discovery-results">
        {filteredVenues.length === 0 ? (
          <p className="rounded-xl border border-slate-800 p-4 text-sm text-slate-400">
            No venues match the selected filters.
          </p>
        ) : (
          filteredVenues.map((venue) => (
            <div
              key={venue.id}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-emerald-500/50 transition cursor-pointer shadow-lg space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-sm font-bold text-slate-100">
                  {venue.name}
                </h3>
                <span
                  data-testid="venue-noise-badge"
                  title={venue.noise}
                  className="max-w-[60%] shrink-0 truncate whitespace-nowrap text-[9px] sm:text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                >
                  {venue.noise}
                </span>
              </div>
              <p className="text-xs text-slate-400">{venue.description}</p>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] text-slate-500 font-mono pt-2 border-t border-slate-800/80">
                <span className="whitespace-nowrap">📍 {venue.distance}</span>
                <span
                  data-testid="venue-desks-status"
                  className="whitespace-nowrap text-emerald-400"
                >
                  {venue.desks} Desks Available
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const rightMap = (
    <div className="w-full h-full bg-slate-900 flex items-center justify-center relative">
      {/* Placeholder for Interactive Leaflet Map Component */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-40" />
      <div className="text-center space-y-2 z-10 p-6">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 animate-pulse">
          🗺️
        </div>
        <h3 className="text-sm font-bold text-slate-200">
          Interactive Leaflet Map View
        </h3>
        <p className="text-xs text-slate-400 max-w-xs mx-auto">
          Vector raster tiles rendered with automatic tile provider fallback and
          proximity markers.
        </p>
      </div>
    </div>
  );

  return (
    <main className="w-full h-screen overflow-hidden bg-slate-950">
      <SplitPaneWorkspace
        leftPane={leftFeed}
        rightPane={rightMap}
        defaultRatio={45}
      />
    </main>
  );
}
