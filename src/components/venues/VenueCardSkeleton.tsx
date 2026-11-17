"use client";

import React from "react";

export const VenueCardSkeleton: React.FC = () => {
  return (
    <div
      className="min-h-[356px] w-full rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-md flex flex-col justify-between animate-pulse transition-opacity duration-300"
      data-testid="venue-card-skeleton"
    >
      <div>
        {/* Aspect Ratio 16/10 Image Container Matching Hydrated VenueCard */}
        <div className="w-full aspect-[16/10] rounded-lg bg-zinc-800 mb-3" />

        {/* Title & Action Icons Skeleton Line */}
        <div className="flex items-center justify-between mb-2">
          <div className="h-6 w-2/3 rounded-md bg-zinc-800" />
          <div className="flex gap-2">
            <div className="h-8 w-8 rounded-lg bg-zinc-800" />
            <div className="h-8 w-8 rounded-lg bg-zinc-800" />
          </div>
        </div>

        {/* Description Lines */}
        <div className="space-y-2 mb-3">
          <div className="h-4 w-full rounded bg-zinc-800" />
          <div className="h-4 w-4/5 rounded bg-zinc-800" />
        </div>
      </div>

      {/* Badges & Amenities Bottom Section (Standardized Height offset) */}
      <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/60">
        <div className="h-5 w-16 rounded-full bg-zinc-800" />
        <div className="h-5 w-20 rounded-full bg-zinc-800" />
        <div className="h-5 w-14 rounded-full bg-zinc-800" />
      </div>
    </div>
  );
};

export default VenueCardSkeleton;