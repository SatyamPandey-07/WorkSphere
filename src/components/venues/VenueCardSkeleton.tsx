"use client";

import { cn } from "@/lib/utils";

interface HudSkeletonBlockProps {
  className?: string;
  "data-testid"?: string;
}

/**
 * HUD blueprint placeholder block: emerald phosphor scanline shimmer over a
 * dark translucent grid. Sized purely via className so it can mirror the
 * exact dimensions of the real VenueCard layout blocks (no layout shift).
 */
function HudSkeletonBlock({ className, "data-testid": testId }: HudSkeletonBlockProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "hud-phosphor hud-scan relative overflow-hidden rounded-sm",
        className
      )}
      aria-hidden="true"
    />
  );
}

export interface VenueCardSkeletonProps {
  className?: string;
  count?: number;
  compact?: boolean;
  "data-testid"?: string;
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
export function VenueCardSkeleton({
  className,
  count = 1,
  compact = false,
  "data-testid": testId = "venue-card-skeleton-hud",
}: VenueCardSkeletonProps = {}) {
  const safeCount = Math.max(1, count);

  const renderSingleCard = (key: number) => (
    <div
      key={key}
      className={cn(
        "hud-blueprint p-3",
        compact ? "py-2 px-2.5" : "p-3",
        className
      )}
      role="status"
      aria-label="Loading venue card"
      data-testid={safeCount > 1 ? `${testId}-${key}` : testId}
    >
      <span className="sr-only">Loading venue details...</span>
      <div className="flex items-start gap-2">
        {/* Icon placeholder */}
        <HudSkeletonBlock
          data-testid="venue-card-skeleton-icon"
          className={cn(compact ? "w-6 h-6 rounded-md" : "w-8 h-8 rounded-lg")}
        />

        <div className="flex-1 min-w-0">
          {/* Title and score */}
          <div className="flex items-center gap-2 mb-1">
            <HudSkeletonBlock
              data-testid="venue-card-skeleton-title"
              className={cn(compact ? "h-3.5 w-24" : "h-4 w-32")}
            />
            <HudSkeletonBlock
              data-testid="venue-card-skeleton-score"
              className={cn(compact ? "h-3.5 w-10" : "h-4 w-12")}
            />
          </div>

          {/* Category */}
          <HudSkeletonBlock
            data-testid="venue-card-skeleton-category"
            className={cn(compact ? "h-2.5 w-16 mb-1" : "h-3 w-20 mb-1")}
          />

          {/* Address */}
          <HudSkeletonBlock
            data-testid="venue-card-skeleton-address"
            className={cn(compact ? "h-2.5 w-32 mb-1.5" : "h-3 w-40 mb-2")}
          />

          {/* Amenity badges */}
          <div
            data-testid="venue-card-skeleton-amenities"
            className="flex items-center gap-2 mb-2"
          >
            <HudSkeletonBlock className={cn(compact ? "h-3.5 w-10" : "h-4 w-14")} />
            <HudSkeletonBlock className={cn(compact ? "h-3.5 w-12" : "h-4 w-16")} />
            <HudSkeletonBlock className={cn(compact ? "h-3.5 w-10" : "h-4 w-12")} />
          </div>

          {/* Action buttons */}
          <div
            data-testid="venue-card-skeleton-actions"
            className="flex items-center gap-1 pt-2 border-t border-emerald-500/15"
          >
            <HudSkeletonBlock className={cn(compact ? "h-5 w-16" : "h-6 w-20")} />
            <HudSkeletonBlock className={cn(compact ? "h-5 w-12" : "h-6 w-14")} />
            <HudSkeletonBlock className={cn(compact ? "h-5 w-10" : "h-6 w-12")} />
          </div>
        </div>
      </div>
    </div>
  );

  if (safeCount > 1) {
    return (
      <div
        data-testid="venue-card-skeleton-group"
        className="space-y-3"
      >
        {Array.from({ length: safeCount }, (_, i) => renderSingleCard(i))}
      </div>
    );
  }

  return renderSingleCard(0);
}

export default VenueCardSkeleton;
