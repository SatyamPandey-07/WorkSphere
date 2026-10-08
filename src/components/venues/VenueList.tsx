"use client";

import React, { useMemo, useState, useEffect } from "react";
import { VenueCard } from "@/components/VenueCard";
import { MapPin } from "lucide-react";
import {
  sortVenuesByProximity,
  filterVenuesByRadius,
  formatWalkingTimeBadge,
  haversineKm,
} from "@/lib/distance";

export interface VenueListProps {
  venues: any[];
  userLocation?: { lat: number; lng: number } | null;
  sortByProximity?: boolean;
  maxDistanceKm?: number;
  className?: string;
  onBookmarkToggle?: (venueId: string) => void;
}

/**
 * VenueList renders venue cards in a responsive grid, with computed distance badge indicators
 * on the card corner and proximity sorting when user GPS location permissions are granted.
 */
export function VenueList({
  venues,
  userLocation = null,
  sortByProximity = false,
  maxDistanceKm,
  className = "",
  onBookmarkToggle,
}: VenueListProps) {
  const [internalLocation, setInternalLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // Attempt browser GPS coordinates if userLocation prop was not passed
  useEffect(() => {
    if (userLocation) return;
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setInternalLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        () => {
          // Gracefully hide badge if location access is denied
          setInternalLocation(null);
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    }
  }, [userLocation]);

  const activeLocation = userLocation || internalLocation;

  const processedVenues = useMemo(() => {
    let result = [...venues];

    if (maxDistanceKm && maxDistanceKm > 0 && activeLocation) {
      result = filterVenuesByRadius(result, activeLocation, maxDistanceKm);
    }

    if (sortByProximity && activeLocation) {
      result = sortVenuesByProximity(result, activeLocation);
    }

    return result;
  }, [venues, activeLocation, sortByProximity, maxDistanceKm]);

  if (processedVenues.length === 0) {
    return (
      <div
        data-testid="venue-list-empty"
        className="text-center py-12 text-zinc-500 dark:text-zinc-400"
      >
        No venues found matching your distance and location criteria.
      </div>
    );
  }

  return (
    <div
      data-testid="venue-list-grid"
      className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 ${className}`}
    >
      {processedVenues.map((venue) => {
        const vLat = venue.latitude ?? venue.lat;
        const vLon = venue.longitude ?? venue.lng;
        const computedDistance =
          activeLocation &&
          vLat != null &&
          vLon != null &&
          !isNaN(Number(vLat)) &&
          !isNaN(Number(vLon))
            ? haversineKm(
                activeLocation.lat,
                activeLocation.lng,
                Number(vLat),
                Number(vLon)
              )
            : null;

        const venueId = venue.id || venue.placeId || "unknown";

        return (
          <div key={venueId} className="relative group">
            <VenueCard venue={venue} onBookmarkToggle={onBookmarkToggle} />

            {computedDistance !== null && (
              <div
                data-testid={`distance-badge-${venueId}`}
                className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-900/80 dark:bg-zinc-800/80 backdrop-blur-md text-white border border-white/10 shadow-md pointer-events-none"
                aria-label={`${computedDistance.toFixed(1)} km away`}
              >
                <MapPin
                  className="w-3 h-3 text-blue-400 shrink-0"
                  aria-hidden="true"
                />
                <span>{computedDistance.toFixed(1)} km away</span>
              </div>
            )}

            {computedDistance !== null && (
              <span
                data-testid={`walking-badge-${venueId}`}
                className="sr-only"
              >
                {formatWalkingTimeBadge(computedDistance)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default VenueList;
