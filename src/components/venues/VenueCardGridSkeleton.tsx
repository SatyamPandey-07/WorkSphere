"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface VenueCardGridSkeletonProps {
  count?: number;
  columns?: 1 | 2 | 3 | 4;
  viewMode?: "grid" | "list";
  className?: string;
  cardClassName?: string;
}

/**
 * Single venue card placeholder matching the visual layout of VenueCard.tsx
 */
export function VenueCardItemSkeleton({
  className,
  viewMode = "grid",
}: {
  className?: string;
  viewMode?: "grid" | "list";
}) {
  if (viewMode === "list") {
    return (
      <div
        className={cn(
          "flex flex-col sm:flex-row items-stretch bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs animate-pulse",
          className,
        )}
      >
        {/* Thumbnail Image placeholder */}
        <div className="sm:w-64 h-48 sm:h-auto bg-zinc-200 dark:bg-zinc-800 relative shrink-0">
          <div className="absolute top-3 left-3">
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="absolute top-3 right-3">
            <Skeleton className="w-8 h-8 rounded-xl" />
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div>
            {/* Header: Title & rating */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-5 w-48 max-w-[80%]" />
                <Skeleton className="h-3.5 w-32" />
              </div>
              <Skeleton className="h-6 w-14 rounded-lg shrink-0" />
            </div>

            {/* Address */}
            <Skeleton className="h-3 w-56 max-w-full mb-3" />

            {/* Amenity Badges */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>

          {/* Footer: Price & CTA */}
          <div className="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
            <Skeleton className="h-5 w-24" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-24 rounded-xl" />
              <Skeleton className="h-9 w-28 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <article
      className={cn(
        "flex flex-col bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs hover:shadow-md transition-all duration-300",
        className,
      )}
    >
      {/* Venue Photo / Banner */}
      <div className="relative aspect-16/10 w-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        {/* Shimmer gradient highlight */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 dark:via-white/5 to-transparent animate-shimmer" />

        {/* Top Badges */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <Skeleton className="h-6 w-20 rounded-full bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xs" />
          <Skeleton className="h-6 w-16 rounded-full bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xs" />
        </div>

        {/* Top-Right Bookmark Button */}
        <div className="absolute top-3 right-3">
          <Skeleton className="w-8 h-8 rounded-xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xs" />
        </div>

        {/* Bottom-left occupancy/vibe indicator */}
        <div className="absolute bottom-3 left-3">
          <Skeleton className="h-5 w-28 rounded-md bg-zinc-900/60 backdrop-blur-xs" />
        </div>
      </div>

      {/* Venue Body Details */}
      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
        <div className="space-y-3">
          {/* Title and Rating Row */}
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1.5 flex-1 min-w-0">
              <Skeleton className="h-5 w-44 max-w-[85%]" />
              <Skeleton className="h-3.5 w-28" />
            </div>
            <Skeleton className="h-6 w-12 rounded-lg shrink-0" />
          </div>

          {/* Address / Distance */}
          <div className="flex items-center gap-1.5">
            <Skeleton className="w-3.5 h-3.5 rounded-full" />
            <Skeleton className="h-3 w-40" />
          </div>

          {/* Amenity Badges: Wifi, Outlets, Noise */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Skeleton className="h-6 w-20 rounded-lg" />
            <Skeleton className="h-6 w-16 rounded-lg" />
            <Skeleton className="h-6 w-24 rounded-lg" />
          </div>
        </div>

        {/* Card Footer: Price & Booking Action */}
        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 mt-auto">
          <div className="space-y-1">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-9 w-28 rounded-xl" />
        </div>
      </div>
    </article>
  );
}

/**
 * Responsive Venue Card Grid Skeleton Placeholder during initial load.
 */
export function VenueCardGridSkeleton({
  count = 6,
  columns = 3,
  viewMode = "grid",
  className,
  cardClassName,
}: VenueCardGridSkeletonProps) {
  const columnClasses = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  }[columns];

  return (
    <section
      role="status"
      aria-label="Loading workspace venues"
      aria-busy="true"
      className={cn(
        "w-full",
        viewMode === "list"
          ? "space-y-4"
          : cn("grid gap-4 sm:gap-6", columnClasses),
        className,
      )}
    >
      <span className="sr-only">Loading venues, please wait...</span>
      {Array.from({ length: count }).map((_, index) => (
        <VenueCardItemSkeleton
          key={`venue-skeleton-${index}`}
          viewMode={viewMode}
          className={cardClassName}
        />
      ))}
    </section>
  );
}

export default VenueCardGridSkeleton;
