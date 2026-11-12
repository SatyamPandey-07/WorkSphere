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
