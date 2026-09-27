"use client";

import { useCallback, useState } from "react";
import { saveVenueOffline } from "@/lib/offlineStorage";
import { type OfflineVenue } from "@/lib/offlineStorage";

export type CityPackStatus = "idle" | "downloading" | "complete" | "error";

interface CityBounds {
  lat: number;
  lng: number;
  radiusKm?: number; // default: 15km radius around city center
}

interface UseCityDataPackResult {
  status: CityPackStatus;
  downloadedCount: number;
  totalCount: number;
  error: string | null;
  downloadCityPack: (cityName: string, bounds: CityBounds) => Promise<void>;
  cancel: () => void;
}

/**
 * Downloads the top 50 venues for a city into IndexedDB so users can
 * browse WorkSphere offline after arriving at a new destination.
 */
export function useCityDataPack(): UseCityDataPackResult {
  const [status, setStatus] = useState<CityPackStatus>("idle");
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = { current: false };

  const downloadCityPack = useCallback(
    async (cityName: string, bounds: CityBounds) => {
      setStatus("downloading");
      setDownloadedCount(0);
      setError(null);
      cancelledRef.current = false;

      try {
        const { lat, lng, radiusKm = 15 } = bounds;

        // Fetch venue list for the city
        const params = new URLSearchParams({
          lat: lat.toString(),
          lng: lng.toString(),
          radius: (radiusKm * 1000).toString(), // convert to metres
          limit: "50",
          format: "offline",
        });

        const response = await fetch(`/api/venues?${params}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch city venues (${response.status})`);
        }

        const data = await response.json();
        const venues: OfflineVenue[] = (data.venues || []).map(
          (v: {
            id: string;
            name: string;
            category?: string;
            latitude?: number;
            longitude?: number;
            address?: string;
            imageUrl?: string;
            rating?: number;
          }) => ({
            id: v.id,
            name: v.name,
            category: v.category,
            lat: v.latitude,
            lng: v.longitude,
            address: v.address,
            imageUrl: v.imageUrl,
            rating: v.rating,
            savedAt: Date.now(),
          }),
        );

        setTotalCount(venues.length);

        for (const venue of venues) {
          if (cancelledRef.current) break;
          await saveVenueOffline(venue);
          setDownloadedCount((prev) => prev + 1);
        }

        if (!cancelledRef.current) {
          setStatus("complete");
          console.log(
            `[CityDataPack] Downloaded ${venues.length} venues for "${cityName}"`,
          );
        } else {
          setStatus("idle");
        }
      } catch (err) {
        if (!cancelledRef.current) {
          const msg = err instanceof Error ? err.message : "Download failed";
          setError(msg);
          setStatus("error");
          console.error("[CityDataPack] Error:", err);
        }
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setStatus("idle");
  }, []);

  return { status, downloadedCount, totalCount, error, downloadCityPack, cancel };
}
