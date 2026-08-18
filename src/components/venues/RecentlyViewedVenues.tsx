"use client";

import { useEffect, useState } from "react";
import { MapPin, X } from "lucide-react";
import Link from "next/link";
import {
  RECENTLY_VIEWED_STORAGE_KEY,
  type RecentlyViewedVenue,
} from "@/components/venues/RecentlyViewedTracker";

export function RecentlyViewedVenues() {
  const [venues, setVenues] = useState<RecentlyViewedVenue[]>([]);

  const loadRecentlyViewed = () => {
    try {
      const stored = localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY);

      if (!stored) {
        setVenues([]);
        return;
      }

      const parsed = JSON.parse(stored);

      if (Array.isArray(parsed)) {
        setVenues(parsed.slice(0, 5));
      } else {
        setVenues([]);
      }
    } catch (error) {
      console.error("Failed to load recently viewed venues:", error);
      setVenues([]);
    }
  };

  useEffect(() => {
    loadRecentlyViewed();
  }, []);

  const handleClear = () => {
    localStorage.removeItem(RECENTLY_VIEWED_STORAGE_KEY);
    setVenues([]);
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
          <Link
            key={venue.id}
            href={`/venues/${venue.id}`}
            className="group rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 transition-all hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-zinc-800 dark:text-zinc-100">
                  {venue.name}
                </p>

                {venue.address && (
                  <p className="mt-1 flex items-start gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="line-clamp-2">{venue.address}</span>
                  </p>
                )}
              </div>

              <X
                className="h-4 w-4 shrink-0 text-transparent group-hover:text-zinc-300 dark:group-hover:text-zinc-600"
                aria-hidden="true"
              />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
