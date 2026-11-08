"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getRecentlyViewedVenueOffline,
  type RecentlyViewedVenuePayload,
} from "@/lib/offlineStorage";

export interface OfflineVenueState {
  venue: RecentlyViewedVenuePayload | null;
  amenities: string[];
  floorplan: unknown | null;
  isOffline: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to retrieve venue details, amenities, and floorplan with offline fallback
 * from IndexedDB when navigator.onLine === false or when network request fails.
 */
export function useOfflineVenue(venueId: string | undefined): OfflineVenueState {
  const [venue, setVenue] = useState<RecentlyViewedVenuePayload | null>(null);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [floorplan, setFloorplan] = useState<unknown | null>(null);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadOfflineVenue = useCallback(async (id: string) => {
    try {
      const cached = await getRecentlyViewedVenueOffline(id);
      if (cached) {
        setVenue(cached);
        setAmenities(cached.amenities || []);
        setFloorplan(cached.floorplan || null);
        return true;
      }
    } catch (err) {
      console.warn("[useOfflineVenue] Failed to read from IndexedDB:", err);
    }
    return false;
  }, []);

  useEffect(() => {
    if (!venueId) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const handleOnlineStatus = async () => {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (isMounted) setIsOffline(offline);

      if (offline) {
        await loadOfflineVenue(venueId);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnlineStatus);
      window.addEventListener("offline", handleOnlineStatus);
    }

    const initLoad = async () => {
      setIsLoading(true);
      setError(null);

      // If offline, directly serve from IndexedDB cache
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await loadOfflineVenue(venueId);
        if (isMounted) setIsLoading(false);
        return;
      }

      // If online, attempt fetch with fallback to IndexedDB cache
      try {
        const res = await fetch(`/api/venues/${venueId}`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setVenue(data.venue || data);
            setAmenities(data.amenities || data.venue?.amenities || []);
            setFloorplan(data.floorplan || data.venue?.floorplan || null);
          }
        } else {
          // Fall back to IndexedDB
          await loadOfflineVenue(venueId);
        }
      } catch (err) {
        // Network failure (e.g. lost connectivity mid-session) — fall back to IndexedDB
        const loaded = await loadOfflineVenue(venueId);
        if (!loaded && isMounted) {
          setError(err instanceof Error ? err : new Error("Network error"));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    initLoad();

    return () => {
      isMounted = false;
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnlineStatus);
        window.removeEventListener("offline", handleOnlineStatus);
      }
    };
  }, [venueId, loadOfflineVenue]);

  return {
    venue,
    amenities,
    floorplan,
    isOffline,
    isLoading,
    error,
  };
}

/**
 * Client-side fetch interceptor that serves cached data when offline.
 */
export async function fetchWithOfflineFallback(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  if (isOffline) {
    const urlStr = typeof input === "string" ? input : input.toString();

    // Intercept venue detail requests
    const venueMatch = urlStr.match(/\/api\/venues\/([^?#/]+)/);
    if (venueMatch && venueMatch[1]) {
      const cached = await getRecentlyViewedVenueOffline(venueMatch[1]);
      if (cached) {
        return new Response(JSON.stringify(cached), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Intercept availability / floorplan requests
    if (urlStr.includes("/api/reservations/availability")) {
      return new Response(
        JSON.stringify({
          seats: [],
          available: true,
          offline: true,
          message: "Offline mode: live seating disabled",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  try {
    return await fetch(input, init);
  } catch (err) {
    // If fetch failed due to network error, check if it's a venue or reservation call
    const urlStr = typeof input === "string" ? input : input.toString();
    const venueMatch = urlStr.match(/\/api\/venues\/([^?#/]+)/);
    if (venueMatch && venueMatch[1]) {
      const cached = await getRecentlyViewedVenueOffline(venueMatch[1]);
      if (cached) {
        return new Response(JSON.stringify(cached), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (urlStr.includes("/api/reservations/availability")) {
      return new Response(
        JSON.stringify({
          seats: [],
          available: true,
          offline: true,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    throw err;
  }
}
