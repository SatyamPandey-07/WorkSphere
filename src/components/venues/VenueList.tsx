"use client";

import React, { useMemo, useState, useEffect } from "react";
import { VenueCard } from "@/components/VenueCard";
import { cn } from "@/lib/utils";
import { MapPin, Clock } from "lucide-react";
import {
  sortVenuesByProximity,
  filterVenuesByRadius,
  formatWalkingTimeBadge,
  haversineKm,
} from "@/lib/distance";
import { getVenueHoursStatus } from "@/lib/venueHours";

export interface VenueListProps {
  venues?: any[];
  userLocation?: { lat: number; lng: number } | null;
  sortByProximity?: boolean;
  maxDistanceKm?: number;
  showOpenNowFilter?: boolean;
  className?: string;
  "data-testid"?: string;
  onBookmarkToggle?: (venueId: string) => void;
}

/**
 * Checks if a venue is currently open based on explicit status or operating hours.
 */
export function isVenueCurrentlyOpen(venue: any, now = new Date()): boolean {
  if (!venue) return false;
  if (typeof venue.openNow === "boolean") return venue.openNow;
  if (typeof venue.isOpen === "boolean") return venue.isOpen;

  const hours =
    venue.hours ||
    venue.openingHours ||
    venue.opening_hours ||
    venue.hoursStr ||
    venue.structuredHours;

  if (hours) {
    const status = getVenueHoursStatus(
      typeof hours === "string" ? hours : JSON.stringify(hours),
      now,
      venue.timezone || venue.timeZone,
    );
    return Boolean(status.isOpen);
  }

  return false;
}

/**
 * VenueList renders venue cards in a responsive grid, with computed distance badge indicators
 * on the card corner, 'Open Now' quick filter chip, and proximity sorting when user GPS location permissions are granted.
 */
export function VenueList({
  venues = [],
  userLocation = null,
  sortByProximity = false,
  maxDistanceKm,
  showOpenNowFilter = true,
  className = "",
  onBookmarkToggle,
  ...props
}: VenueListProps) {
  const [openNowOnly, setOpenNowOnly] = useState(false);
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
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 },
      );
    }
  }, [userLocation]);

  const activeLocation = userLocation || internalLocation;
  const rawVenues = Array.isArray(venues) ? venues : [];

  const processedVenues = useMemo(() => {
    let result = [...rawVenues];

    if (openNowOnly) {
      result = result.filter((v) => isVenueCurrentlyOpen(v));
    }

    if (maxDistanceKm && maxDistanceKm > 0 && activeLocation) {
      result = filterVenuesByRadius(result, activeLocation, maxDistanceKm);
    }

    if (sortByProximity && activeLocation) {
      result = sortVenuesByProximity(result, activeLocation);
    }

    return result;
  }, [rawVenues, activeLocation, sortByProximity, maxDistanceKm, openNowOnly]);

  return (
    <div
      data-testid={props["data-testid"] || "venue-list"}
      className="space-y-4"
    >
      {showOpenNowFilter && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="open-now-filter-chip"
            onClick={() => setOpenNowOnly((prev) => !prev)}
            aria-pressed={openNowOnly}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all shadow-sm ${
              openNowOnly
                ? "bg-emerald-600 text-white shadow-emerald-500/20 ring-2 ring-emerald-500/30"
                : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/80"
            }`}
          >
            <Clock
              className={`w-3.5 h-3.5 ${openNowOnly ? "text-white" : "text-emerald-500"}`}
            />
            <span>Open Now</span>
            {openNowOnly && (
              <span className="ml-1 text-[10px] bg-white/20 px-1.5 py-0.2 rounded-full">
                {processedVenues.length}
              </span>
            )}
          </button>
        </div>
      )}

      {processedVenues.length === 0 ? (
        <div
          data-testid="venue-list-empty"
          className="text-center py-12 text-zinc-500 dark:text-zinc-400"
        >
          {openNowOnly
            ? "No venues currently open matching your criteria."
            : "No venues found matching your distance and location criteria."}
        </div>
      ) : (
        <div
          data-testid="venue-list-grid"
          className={cn(
            "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6",
            className
          )}
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
                    Number(vLon),
                  )
                : null;

            const venueId = venue.id || venue.placeId || "unknown";

            return (
              <div key={venueId} className="relative group">
                <VenueCard
                  venue={venue}
                  onSaveFavorite={
                    onBookmarkToggle
                      ? (saved) => onBookmarkToggle(saved.id)
                      : undefined
                  }
                />

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
      )}
    </div>
  );
}

export default VenueList;
