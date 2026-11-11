"use client";

import React, { useState, useEffect } from "react";
import VenueCard, { VenueCardProps } from "@/components/venue/VenueCard";
import VenueCardSkeleton from "@/components/venues/VenueCardSkeleton";

interface VenueGridProps {
  venues?: Array<VenueCardProps["venue"]>;
  isLoading?: boolean;
}

export const VenueGrid: React.FC<VenueGridProps> = ({
  venues = [],
  isLoading = false,
}) => {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const showSkeletons = isLoading || !hydrated;

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full"
      data-testid="venue-grid"
    >
      {showSkeletons
        ? Array.from({ length: 6 }).map((_, idx) => (
            <div key={`skeleton-${idx}`} className="w-full min-h-[356px]">
              <VenueCardSkeleton />
            </div>
          ))
        : venues.map((venue) => (
            <div
              key={venue.id}
              className="w-full min-h-[356px] transition-opacity duration-300 opacity-100 animate-in fade-in-50"
            >
              <VenueCard venue={venue} />
            </div>
          ))}
    </div>
  );
};

export default VenueGrid;