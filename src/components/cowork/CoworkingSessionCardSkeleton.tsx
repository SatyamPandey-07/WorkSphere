"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface CoworkingSessionCardSkeletonProps {
  className?: string;
  count?: number;
  "data-testid"?: string;
}

interface ShimmerElementProps {
  className?: string;
  "data-testid"?: string;
  "aria-hidden"?: boolean;
}

/**
 * Reusable shimmer placeholder block using CSS pulse gradients
 * with dark, light, and cyberpunk theme compatibility.
 */
export function CoworkingShimmer({
  className,
  "data-testid": testId,
  "aria-hidden": ariaHidden = true,
}: ShimmerElementProps) {
  return (
    <div
      data-testid={testId}
      aria-hidden={ariaHidden}
      className={cn(
        // Base pulse gradient required:
        "bg-gradient-to-r from-zinc-800 via-zinc-700 to-zinc-800 bg-[length:200%_100%] animate-shimmer",
        // Light theme adaptation:
        "[html:not(.dark):not(.cyberpunk)_&]:from-zinc-200 [html:not(.dark):not(.cyberpunk)_&]:via-zinc-100 [html:not(.dark):not(.cyberpunk)_&]:to-zinc-200",
        // Dark theme:
        "dark:from-zinc-800 dark:via-zinc-700 dark:to-zinc-800",
        // Cyberpunk theme:
        "cyberpunk:from-purple-950/70 cyberpunk:via-cyan-900/40 cyberpunk:to-purple-950/70",
        "[.cyberpunk_&]:from-purple-950/70 [.cyberpunk_&]:via-cyan-900/40 [.cyberpunk_&]:to-purple-950/70",
        className
      )}
    />
  );
}

/**
 * CoworkingSessionCardSkeleton
 *
 * Replicates the exact layout dimensions of CoworkingSessionCard:
 * - Avatar badges (host avatar badge and attendees avatar cluster)
 * - Host title (session / host title in header & details)
 * - Time slot (scheduled session time block)
 * - Action button (Add to Calendar dropdown button)
 *
 * Theme-compatible across Dark, Light, and Cyberpunk themes.
 */
export const CoworkingSessionCardSkeleton: React.FC<CoworkingSessionCardSkeletonProps> = ({
  className,
  count = 1,
  "data-testid": testId = "coworking-session-card-skeleton",
}) => {
  const safeCount = Math.max(1, count);

  const renderSingleCard = (key: number) => (
    <div
      key={key}
      data-testid={safeCount > 1 ? `${testId}-${key}` : testId}
      role="status"
      aria-label="Loading coworking session"
      className={cn(
        // Dimensions matching CoworkingSessionCard (max-w-md, p-5, rounded-xl, shadow-xl)
        "max-w-md w-full rounded-xl p-5 shadow-xl transition-colors duration-200",
        // Light theme
        "bg-white border border-zinc-200 text-zinc-900 shadow-zinc-200/50",
        // Dark theme
        "dark:bg-slate-900 dark:border-slate-800 dark:text-white dark:shadow-xl",
        // Cyberpunk theme
        "cyberpunk:bg-[#090014]/90 cyberpunk:border-cyan-500/40 cyberpunk:shadow-[0_0_20px_rgba(6,182,212,0.15)]",
        "[.cyberpunk_&]:bg-[#090014]/90 [.cyberpunk_&]:border-cyan-500/40 [.cyberpunk_&]:shadow-[0_0_20px_rgba(6,182,212,0.15)]",
        className
      )}
    >
      <span className="sr-only">Loading coworking session details...</span>

      {/* Header: Host/Session Title and Session Badge */}
      <div className="flex items-center justify-between mb-3">
        <CoworkingShimmer
          data-testid="skeleton-host-title"
          className="h-6 w-44 rounded-md"
        />
        <CoworkingShimmer
          data-testid="skeleton-session-badge"
          className="h-6 w-32 rounded-full"
        />
      </div>

      {/* Description lines */}
      <div className="space-y-2 mb-4">
        <CoworkingShimmer
          data-testid="skeleton-description-line1"
          className="h-4 w-full rounded-md"
        />
        <CoworkingShimmer
          data-testid="skeleton-description-line2"
          className="h-4 w-4/5 rounded-md"
        />
      </div>

      {/* Details section: Venue, Host with Avatar Badge, Attendees with Avatar Badges, Time Slot */}
      <div className="space-y-2.5 text-xs mb-5 border-t border-zinc-200 dark:border-slate-800 cyberpunk:border-cyan-500/30 [.cyberpunk_&]:border-cyan-500/30 pt-3">
        {/* Venue row */}
        <div className="flex items-center gap-2">
          <CoworkingShimmer
            data-testid="skeleton-venue-icon"
            className="w-4 h-4 rounded-full shrink-0"
          />
          <CoworkingShimmer
            data-testid="skeleton-venue-text"
            className="h-3.5 w-40 rounded"
          />
        </div>

        {/* Host row: Avatar badge & Host title */}
        <div className="flex items-center gap-2">
          <CoworkingShimmer
            data-testid="skeleton-host-avatar-badge"
            className="w-5 h-5 rounded-full shrink-0"
          />
          <CoworkingShimmer
            data-testid="skeleton-host-details"
            className="h-3.5 w-32 rounded"
          />
        </div>

        {/* Time slot row */}
        <div className="flex items-center gap-2">
          <CoworkingShimmer
            data-testid="skeleton-time-icon"
            className="w-4 h-4 rounded-full shrink-0"
          />
          <CoworkingShimmer
            data-testid="skeleton-time-slot"
            className="h-3.5 w-36 rounded"
          />
        </div>

        {/* Attendees row with avatar badges cluster */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center gap-2">
            <CoworkingShimmer
              data-testid="skeleton-attendees-icon"
              className="w-4 h-4 rounded-full shrink-0"
            />
            <CoworkingShimmer
              data-testid="skeleton-attendees-count"
              className="h-3.5 w-24 rounded"
            />
          </div>
          {/* Avatar badges cluster */}
          <div
            data-testid="skeleton-avatar-badges"
            className="flex items-center -space-x-1.5"
          >
            <CoworkingShimmer className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-slate-900 cyberpunk:ring-[#090014] [.cyberpunk_&]:ring-[#090014]" />
            <CoworkingShimmer className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-slate-900 cyberpunk:ring-[#090014] [.cyberpunk_&]:ring-[#090014]" />
            <CoworkingShimmer className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-slate-900 cyberpunk:ring-[#090014] [.cyberpunk_&]:ring-[#090014]" />
          </div>
        </div>
      </div>

      {/* Action Button: Replicates "Add to Calendar" dropdown button */}
      <div className="relative">
        <CoworkingShimmer
          data-testid="skeleton-action-button"
          className="w-full h-10 rounded-lg"
        />
      </div>
    </div>
  );

  if (safeCount > 1) {
    return (
      <div
        data-testid="coworking-session-skeleton-group"
        className="space-y-4"
      >
        {Array.from({ length: safeCount }, (_, i) => renderSingleCard(i))}
      </div>
    );
  }

  return renderSingleCard(0);
};

export default CoworkingSessionCardSkeleton;
