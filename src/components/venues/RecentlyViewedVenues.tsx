"use client";

import { useEffect, useState } from "react";
import { MapPin, X } from "lucide-react";
import Link from "next/link";
import {
  type RecentlyViewedVenue,
  getRecentlyViewedVenues,
  removeRecentlyViewedVenue,
  clearRecentlyViewedVenues,
} from "@/components/venues/RecentlyViewedTracker";

export function RecentlyViewedVenues() {
  const [venues, setVenues] = useState<RecentlyViewedVenue[]>([]);

  const loadRecentlyViewed = () => {
    setVenues(getRecentlyViewedVenues());
  };

  useEffect(() => {
    loadRecentlyViewed();
  }, []);

  const handleClear = () => {
    clearRecentlyViewedVenues();
    setVenues([]);
  };

  const handleRemove = (venueId: string) => {
    const updated = removeRecentlyViewedVenue(venueId);
    setVenues(updated);
  };

  if (venues.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="recently-viewed-heading" className="space-y-2">
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
        <p
          id="recently-viewed-heading"
          className="text-[10px] uppercase font-black tracking-widest text-zinc-400"
        >
          Recently Viewed
        </p>

        <button
          type="button"
          onClick={handleClear}
          className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        >
          Clear
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {venues.map((venue) => (
          <div
            key={venue.id}
            data-testid={`recently-viewed-item-${venue.id}`}
            className="group relative flex items-start justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 transition-all hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm"
          >
            <Link
              href={`/venues/${venue.id}`}
              className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
            >
              <p className="truncate text-sm font-bold text-zinc-800 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                {venue.name}
              </p>

              {venue.address && (
                <p className="mt-1 flex items-start gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="line-clamp-2">{venue.address}</span>
                </p>
              )}
            </Link>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleRemove(venue.id);
              }}
              aria-label={`Remove ${venue.name} from recently viewed`}
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors opacity-80 group-hover:opacity-100"
            >
              <X className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
