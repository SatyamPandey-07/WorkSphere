"use client";

import { useCallback, useState } from "react";
import { type MapMarker } from "@/types/map";
import { haversineKm } from "@/lib/distance";

interface AlternativeVenueOptions {
  /** User's current GPS position for distance sorting */
  userLocation?: { lat: number; lng: number };
  /** Number of alternatives to return (default: 3) */
  count?: number;
}

/**
 * Returns the closest `count` venues from `allVenues` that are NOT the full
 * venue and share at least one amenity with it (WiFi, outlets, quiet zone).
 *
 * Used to suggest alternatives when a venue is at capacity (Issue #2085).
 */
export function findAlternativeVenues(
  fullVenue: MapMarker,
  allVenues: MapMarker[],
  options: AlternativeVenueOptions = {},
): MapMarker[] {
  const { userLocation, count = 3 } = options;

  const candidates = allVenues.filter((v) => {
    if (v.id === fullVenue.id) return false;
    // Prefer venues with similar amenities
    const sameWifi = fullVenue.wifiQuality !== undefined
      ? (v.wifiQuality ?? 0) >= (fullVenue.wifiQuality ?? 0) - 1
      : true;
    const sameOutlets = !fullVenue.hasOutlets || v.hasOutlets;
    const sameQuiet = !fullVenue.amenities?.quiet || v.amenities?.quiet;
    return sameWifi || sameOutlets || sameQuiet;
  });

  if (userLocation) {
    candidates.sort((a, b) => {
      const distA = haversineKm(
        userLocation.lat, userLocation.lng,
        a.position.lat, a.position.lng,
      );
      const distB = haversineKm(
        userLocation.lat, userLocation.lng,
        b.position.lat, b.position.lng,
      );
      return distA - distB;
    });
  }

  return candidates.slice(0, count);
}

/**
 * Hook that manages the "venue is full" alternative suggestion flow.
 *
 * Call `triggerAlternatives(fullVenue, allVenues)` when a booking attempt
 * returns a CAPACITY_EXCEEDED error. The hook returns a list of up to 3
 * nearby alternatives with similar amenities.
 */
export function useAlternativeVenuesSuggestion(
  options: AlternativeVenueOptions = {},
) {
  const [alternatives, setAlternatives] = useState<MapMarker[]>([]);
  const [isShowing, setIsShowing] = useState(false);
  const [fullVenueId, setFullVenueId] = useState<string | null>(null);

  const triggerAlternatives = useCallback(
    (fullVenue: MapMarker, allVenues: MapMarker[]) => {
      const suggestions = findAlternativeVenues(fullVenue, allVenues, options);
      setAlternatives(suggestions);
      setFullVenueId(fullVenue.id);
      setIsShowing(suggestions.length > 0);
    },
    [options],
  );

  const dismiss = useCallback(() => {
    setIsShowing(false);
    setAlternatives([]);
    setFullVenueId(null);
  }, []);

  return { alternatives, isShowing, fullVenueId, triggerAlternatives, dismiss };
}
