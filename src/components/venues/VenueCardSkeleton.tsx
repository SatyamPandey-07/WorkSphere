"use client";

import { cn } from "@/lib/utils";

interface HudSkeletonBlockProps {
  className?: string;
}

/**
 * HUD blueprint placeholder block: emerald phosphor scanline shimmer over a
 * dark translucent grid. Sized purely via className so it can mirror the
 * exact dimensions of the real VenueCard layout blocks (no layout shift).
 */
function HudSkeletonBlock({ className }: HudSkeletonBlockProps) {
  return (
    <div
      className={cn(
        "hud-phosphor hud-scan relative overflow-hidden rounded-sm",
        className
      )}
      aria-hidden="true"
    />
  );
}

/**
 * VenueCardSkeleton — futuristic HUD blueprint loading style.
 *
 * Layout structure, spacing, padding and block dimensions strictly mirror the
 * fully loaded VenueCard (icon, title/score row, category, address, amenity
 * badges, action-button row) so data fetching causes zero layout shift.
 * Chamfered sci-fi corners via clip-path, phosphor scanline shimmer animation,
 * with prefers-reduced-motion / prefers-contrast fallbacks in globals.css.
 */
export default function VenueCardSkeleton() {
  return (
    <div
      className="hud-blueprint p-3"
      role="status"
      aria-label="Loading venue card"
      data-testid="venue-card-skeleton-hud"
    >
      <div className="flex items-start gap-2">
        {/* Icon placeholder */}
        <HudSkeletonBlock className="w-8 h-8 rounded-lg" />

        <div className="flex-1 min-w-0">
          {/* Title and score */}
          <div className="flex items-center gap-2 mb-1">
            <HudSkeletonBlock className="h-4 w-32" />
            <HudSkeletonBlock className="h-4 w-12" />
          </div>

          {/* Category */}
          <HudSkeletonBlock className="h-3 w-20 mb-1" />

          {/* Address */}
          <HudSkeletonBlock className="h-3 w-40 mb-2" />

          {/* Amenity badges */}
          <div className="flex items-center gap-2 mb-2">
            <HudSkeletonBlock className="h-4 w-14" />
            <HudSkeletonBlock className="h-4 w-16" />
            <HudSkeletonBlock className="h-4 w-12" />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 pt-2 border-t border-emerald-500/15">
            <HudSkeletonBlock className="h-6 w-20" />
            <HudSkeletonBlock className="h-6 w-14" />
            <HudSkeletonBlock className="h-6 w-12" />
          </div>
        </div>
      </div>
    </div>
  );
}

export { VenueCardSkeleton };
