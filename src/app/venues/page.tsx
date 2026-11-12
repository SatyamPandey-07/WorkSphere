 feat/noise-level-slider-filter
"use client";

import React, { Suspense, useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import VenueFilterBar, {
  VenueFilterState,
} from "@/components/venues/VenueFilterBar";
import {
  MAX_DB_LIMIT,
  MIN_DB_LIMIT,
  getNoiseZoneInfo,
} from "@/components/venues/NoiseLevelSlider";

interface VenueItem {
  id: string;
  name: string;
  neighborhood: string;
  currentDb: number;
}

const SAMPLE_VENUES: VenueItem[] = [
  {
    id: "v-1",
    name: "Athenaeum Study Loft",
    neighborhood: "Bandra West",
    currentDb: 38,
  },
  {
    id: "v-2",
    name: "Byte & Brew Roasters",
    neighborhood: "Lower Parel",
    currentDb: 54,
  },
  { id: "v-3", name: "Foundry Commons", neighborhood: "Powai", currentDb: 67 },
  {
    id: "v-4",
    name: "Harbor Social Hub",
    neighborhood: "Colaba",
    currentDb: 79,
  },
];

function parseBoundedInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(MIN_DB_LIMIT, Math.min(MAX_DB_LIMIT, parsed));
}

function VenuesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const minDb = parseBoundedInt(searchParams.get("minDb"), MIN_DB_LIMIT);
  const maxDb = parseBoundedInt(searchParams.get("maxDb"), MAX_DB_LIMIT);

  const handleFilterChange = useCallback(
    (next: VenueFilterState) => {
      const params = new URLSearchParams(searchParams.toString());

      if (next.minDb <= MIN_DB_LIMIT) {
        params.delete("minDb");
      } else {
        params.set("minDb", String(next.minDb));
      }

      if (next.maxDb >= MAX_DB_LIMIT) {
        params.delete("maxDb");
      } else {
        params.set("maxDb", String(next.maxDb));
      }

      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const handleReset = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("minDb");
    params.delete("maxDb");
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  const filteredVenues = useMemo(
    () =>
      SAMPLE_VENUES.filter(
        (venue) => venue.currentDb >= minDb && venue.currentDb <= maxDb,
      ),
    [minDb, maxDb],
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-slate-100">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Coworking Venues</h1>
        <p className="mt-1 text-sm text-slate-400">
          Filter spaces by live and predicted acoustic telemetry ({minDb}–
          {maxDb} dB).
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <VenueFilterBar
          filters={{ minDb, maxDb }}
          onFilterChange={handleFilterChange}
          onReset={handleReset}
        />

        <section className="grid flex-1 gap-4 sm:grid-cols-2">
          {filteredVenues.map((venue) => {
            const zone = getNoiseZoneInfo(venue.currentDb);
            return (
              <article
                key={venue.id}
                className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-100">
                      {venue.name}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {venue.neighborhood}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${zone.badgeClass}`}
                  >
                    {venue.currentDb} dB &bull; {zone.label}
                  </span>
                </div>
              </article>
            );
          })}

          {filteredVenues.length === 0 && (
            <div className="col-span-full rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-400">
              No venues match the {minDb}–{maxDb} dB acoustic range. Try
              widening your filter.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function VenuesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-sm text-slate-400">Loading venues...</div>
      }
    >
      <VenuesContent />
    </Suspense>
  );
}

'use client';

import React from 'react';
import { SplitPaneWorkspace } from '@/components/venues/SplitPaneWorkspace';

export default function VenuesDiscoveryPage() {
  const leftFeed = (
    <div className="p-6 space-y-4 h-full overflow-y-auto bg-slate-950 border-r border-slate-900">
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Coworking Discovery Feed</h1>
        <p className="text-xs text-slate-400">
          Explore verified spaces, acoustic ratings, and real-time mesh occupancy.
        </p>
      </div>

      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((id) => (
          <div
            key={id}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-emerald-500/50 transition cursor-pointer shadow-lg space-y-2"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100">WorkSphere Hub #{id} - Downtown Core</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                42 dB • Quiet
              </span>
            </div>
            <p className="text-xs text-slate-400">
              High-speed fiber optics, ergonomic standing desks, and soundproof pod access.
            </p>
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-2 border-t border-slate-800/80">
              <span>📍 450m away</span>
              <span className="text-emerald-400">12 Desks Available</span>
            </div>
          </div>
        ))}
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
        <h3 className="text-sm font-bold text-slate-200">Interactive Leaflet Map View</h3>
        <p className="text-xs text-slate-400 max-w-xs mx-auto">
          Vector raster tiles rendered with automatic tile provider fallback and proximity markers.
        </p>
      </div>
    </div>
  );

  return (
    <main className="w-full h-screen overflow-hidden bg-slate-950">
      <SplitPaneWorkspace leftPane={leftFeed} rightPane={rightMap} defaultRatio={45} />
    </main>
  );
}
 main
