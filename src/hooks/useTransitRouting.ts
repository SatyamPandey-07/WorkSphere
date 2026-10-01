"use client";

import { useCallback, useState } from "react";

export type RouteProfile = "walking" | "cycling" | "driving" | "transit";

export interface TransitRouteResult {
  durationMinutes: number | null;
  distanceKm: number | null;
  summary: string;
  profile: RouteProfile;
}

interface UseTransitRoutingOptions {
  origin: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
}

/**
 * Adds "Transit" as a routing profile alongside walking/cycling/driving.
 * When "transit" is selected, estimates travel time using:
 * 1. Haversine straight-line distance
 * 2. Average urban transit speed (25 km/h average including stops)
 * 3. +5 min boarding/waiting time buffer
 *
 * For accurate transit data, connect to Transitland, OpenTripPlanner, or
 * a city's GTFS API in the production environment.
 */
export function useTransitRouting(options: UseTransitRoutingOptions) {
  const { origin, destination } = options;
  const [activeProfile, setActiveProfile] = useState<RouteProfile>("walking");
  const [transitRoute, setTransitRoute] = useState<TransitRouteResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const estimateTransitRoute = useCallback(
    async (profile: RouteProfile): Promise<TransitRouteResult | null> => {
      if (!origin || !destination || profile !== "transit") return null;

      // Haversine distance
      const R = 6371;
      const dLat = ((destination.lat - origin.lat) * Math.PI) / 180;
      const dLng = ((destination.lng - origin.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((origin.lat * Math.PI) / 180) *
          Math.cos((destination.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      // Transit speed: ~25 km/h average in urban areas + 5 min boarding buffer
      const TRANSIT_SPEED_KMH = 25;
      const BOARDING_BUFFER_MIN = 5;
      const durationMinutes =
        Math.round((distanceKm / TRANSIT_SPEED_KMH) * 60) + BOARDING_BUFFER_MIN;

      const summary =
        distanceKm < 1
          ? `~${durationMinutes} min by transit (${Math.round(distanceKm * 1000)} m)`
          : `~${durationMinutes} min by transit (${distanceKm.toFixed(1)} km)`;

      return {
        durationMinutes,
        distanceKm: Math.round(distanceKm * 100) / 100,
        summary,
        profile: "transit",
      };
    },
    [origin, destination],
  );

  const selectProfile = useCallback(
    async (profile: RouteProfile) => {
      setActiveProfile(profile);

      if (profile === "transit") {
        setIsLoading(true);
        try {
          const result = await estimateTransitRoute(profile);
          setTransitRoute(result);
        } finally {
          setIsLoading(false);
        }
      } else {
        setTransitRoute(null);
      }
    },
    [estimateTransitRoute],
  );

  return { activeProfile, transitRoute, isLoading, selectProfile };
}
