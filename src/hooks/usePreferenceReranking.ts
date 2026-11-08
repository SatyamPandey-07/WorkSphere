import { useMemo, useState, useEffect, useCallback } from "react";
import { Venue } from "@/components/chat/ChatMessages";
import {
  UserHistoryItem,
  buildUserPreferenceVector,
} from "@/lib/preferenceVector";
import { rerankVenues, RerankedVenue } from "@/lib/recommendation";

/** Weight of a saved venue when building the user's taste profile. */
const SAVED_VENUE_WEIGHT = 1.2;

interface FavoriteVenue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  category: string;
  wifiQuality: number | null;
  wifiSpeed: number | null;
  hasOutlets: boolean;
  noiseLevel: string | null;
}

/** Loads the signed-in user's saved venues as preference history. */
function useSavedVenueHistory(enabled: boolean): UserHistoryItem[] {
  const [history, setHistory] = useState<UserHistoryItem[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/favorites")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.favorites)) return;
        setHistory(
          data.favorites
            .map((f: { venue: FavoriteVenue | null }) => f.venue)
            .filter(Boolean)
            .map((v: FavoriteVenue) => ({
              venue: {
                id: v.id,
                name: v.name,
                lat: v.latitude,
                lng: v.longitude,
                category: v.category,
                wifi: (v.wifiQuality ?? 0) >= 3 || (v.wifiSpeed ?? 0) > 0,
                hasOutlets: v.hasOutlets,
                noiseLevel: (v.noiseLevel ?? undefined) as Venue["noiseLevel"],
              },
              weight: SAVED_VENUE_WEIGHT,
            })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return history;
}

export function usePreferenceReranking(results: Venue[]) {
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false);

  // Load user preference on mount
  useEffect(() => {
    const stored = localStorage.getItem("ai_personalization_enabled");
    if (stored !== null) {
      setPersonalizationEnabled(stored === "true");
    }
  }, []);

  const togglePersonalization = useCallback((value?: boolean) => {
    setPersonalizationEnabled((prev) => {
      const next = typeof value === "boolean" ? value : !prev;
      localStorage.setItem("ai_personalization_enabled", String(next));
      return next;
    });
  }, []);

  const history = useSavedVenueHistory(personalizationEnabled);
  const userVector = useMemo(
    () => buildUserPreferenceVector(history),
    [history],
  );

  const rerankedResults = useMemo(() => {
    if (!personalizationEnabled) {
      // Just map to RerankedVenue shape without changing order
      return (results || []).map(
        (v) =>
          ({ ...v, similarityScore: 0, isRecommended: false }) as RerankedVenue,
      );
    }
    return rerankVenues(results || [], userVector);
  }, [results, userVector, personalizationEnabled]);

  const rerankVenuesFn = useCallback(
    (venuesToRank: Venue[]) => {
      if (!personalizationEnabled) {
        return (venuesToRank || []).map(
          (v) =>
            ({
              ...v,
              similarityScore: 0,
              isRecommended: false,
            }) as RerankedVenue,
        );
      }
      return rerankVenues(venuesToRank || [], userVector);
    },
    [personalizationEnabled, userVector],
  );

  const rankVenuesFn = useCallback(
    async (venuesToRank: Venue[]) => {
      return rerankVenuesFn(venuesToRank);
    },
    [rerankVenuesFn],
  );

  return {
    rerankedResults,
    personalizationEnabled,
    togglePersonalization,
    isReady: true,
    isOffline: typeof window !== "undefined" ? !navigator.onLine : false,
    rerankVenues: rerankVenuesFn,
    rankVenues: rankVenuesFn,
    terminate: () => {},
  };
}
