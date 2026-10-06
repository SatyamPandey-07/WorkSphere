"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, ArrowRight, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface BookingVenue {
  id: string;
  name: string;
  category?: string;
}

interface BookingRecord {
  id: string;
  venueId: string;
  status?: string;
  venue?: BookingVenue;
}

export function VisitedVenuesCard() {
  const [visitedVenues, setVisitedVenues] = useState<BookingVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchVisitedVenues() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/bookings", { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 401) {
            // Not authenticated or guest
            if (isMounted) {
              setVisitedVenues([]);
              setLoading(false);
            }
            return;
          }
          throw new Error("Failed to load visited venues");
        }

        const json = await res.json();
        const bookings: BookingRecord[] = json.data || [];

        // Aggregate unique venues
        const venueMap = new Map<string, BookingVenue>();
        for (const booking of bookings) {
          if (booking.status === "CANCELLED") continue;
          const vId = booking.venueId || booking.venue?.id;
          if (vId && !venueMap.has(vId)) {
            venueMap.set(vId, {
              id: vId,
              name: booking.venue?.name || "Workspace",
              category: booking.venue?.category,
            });
          }
        }

        if (isMounted) {
          setVisitedVenues(Array.from(venueMap.values()));
        }
      } catch {
        if (isMounted) {
          setError("Unable to load visited venues statistics");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchVisitedVenues();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div
        data-testid="visited-venues-loading"
        aria-busy="true"
        aria-label="Loading visited venues statistics"
        className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
      >
        <div className="flex items-center gap-3 mb-3">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Skeleton className="h-8 w-16 mb-2" />
      </div>
    );
  }

  const count = visitedVenues.length;

  return (
    <div
      data-testid="visited-venues-card"
      className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 transition-all hover:border-zinc-300 dark:hover:border-zinc-700 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <MapPin className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Venues Visited
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Unique workspaces booked &amp; explored
            </p>
          </div>
        </div>

        {count > 0 && (
          <span
            data-testid="visited-venues-badge"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
          >
            <Sparkles className="w-3 h-3" />
            Active Explorer
          </span>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
        {error ? (
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
        ) : count === 0 ? (
          <div data-testid="visited-venues-empty" className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                0
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                venues visited
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              You haven&apos;t visited any workspaces yet. Discover and book
              your first spot!
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline pt-1"
            >
              Explore workspaces <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span
                data-testid="visited-venues-count"
                className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100"
              >
                {count}
              </span>
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {count === 1 ? "unique venue" : "unique venues"}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
              {visitedVenues.slice(0, 5).map((venue) => (
                <span
                  key={venue.id}
                  className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                >
                  {venue.name}
                </span>
              ))}
              {visitedVenues.length > 5 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                  +{visitedVenues.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
