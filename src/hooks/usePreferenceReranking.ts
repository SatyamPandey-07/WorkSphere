import { useMemo, useState, useEffect } from "react";
import { Venue } from "@/components/chat/ChatMessages";
import {
  UserHistoryItem,
  buildUserPreferenceVector,
} from "@/lib/preferenceVector";
import { rerankVenues, RerankedVenue } from "@/lib/recommendation";

const MOCK_HISTORY: UserHistoryItem[] = [
  {
    venue: {
      id: "mock-1",
      name: "Quiet Cafe",
      lat: 0,
      lng: 0,
      category: "cafe",
      wifi: true,
      noiseLevel: "quiet",
      hasOutlets: true,
    },
    weight: 1.5,
  },
  {
    venue: {
      id: "mock-2",
      name: "Tech Hub",
      lat: 0,
      lng: 0,
      category: "coworking",
      wifi: true,
      noiseLevel: "moderate",
      hasOutlets: true,
    },
    weight: 1.0,
  },
];

export function usePreferenceReranking(results: Venue[]) {
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false);

  // Load user preference on mount
  useEffect(() => {
    const stored = localStorage.getItem("ai_personalization_enabled");
    if (stored !== null) {
      setPersonalizationEnabled(stored === "true");
    }
  }, []);

  // Debounced recompute when preferences change
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void recompute();
    }, debounceMs);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [preferences, recompute, debounceMs]);

  const rankVenues = useCallback(
    async (venues: T[]): Promise<Array<RerankedVenue<T>>> => {
      if (venues.length === 0) {
        setRankedResults([]);
        return [];
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        try {
          const cached = await getPreferenceRanking();
          if (cached && cached.venueIds && cached.scores) {
            const cachedMap = new Map<string, number>();
            cached.venueIds.forEach((id, i) =>
              cachedMap.set(id, cached.scores[i] || 0.5),
            );
            const offlineResult = venues.map((v) => {
              const cScore = cachedMap.get(v.id) ?? 0.5;
              const sScore = (v.score ?? 5) / 10;
              const bScore =
                sScore * cached.weights.serverWeight +
                cScore * cached.weights.clientWeight;
              return {
                original: v,
                id: v.id,
                serverScore: sScore,
                clientScore: cScore,
                blendedScore: bScore,
                nearestCluster: 0,
                distanceToCentroid: 0,
              };
            });
            offlineResult.sort((a, b) => b.blendedScore - a.blendedScore);
            setRankedResults(offlineResult);
            return offlineResult;
          }
        } catch (e) {
          console.error("[usePreferenceReranking] Corrupt cache, clearing", e);
          const clearPromise = clearPreferenceRanking();
          if (clearPromise && typeof clearPromise.catch === "function") {
            await clearPromise.catch(() => {});
          } else {
            await clearPromise;
          }
        }
      }

      lastVenuesRef.current = venues;
      const engine = engineRef.current;
      const maxPossibleDistance = Math.sqrt(KMEANS_DIMENSIONS.length);

      if (!centroids || centroids.centroids.length === 0) {
        // No centroids yet — use server score only
        const fallback = venues.map((venue) => ({
          original: venue,
          id: venue.id,
          serverScore: (venue.score ?? 5) / 10,
          clientScore: 0.5,
          blendedScore: (venue.score ?? 5) / 10,
          nearestCluster: 0,
          distanceToCentroid: 0,
        }));
        fallback.sort((a, b) => b.blendedScore - a.blendedScore);
        setRankedResults(fallback);
        return fallback;
      }

      try {
        const ranked = await engine.rankVenues<T>(
          venues,
          serverWeight,
          clientWeight,
        );

        const result: Array<RerankedVenue<T>> = ranked.map((r) => {
          const venueVec = venueToVector(
            r as unknown as Record<string, unknown>,
          );
          const cluster = nearestCentroidIndex(venueVec, centroids.centroids);
          const dist = euclideanDistance(
            venueVec,
            centroids.centroids[cluster],
          );
          const normalizedDist = Math.min(dist / maxPossibleDistance, 1);
          const clientScore = 1 - normalizedDist;

          return {
            original: r,
            id: r.id,
            serverScore: (r.score ?? 5) / 10,
            clientScore,
            blendedScore: r.score ? r.score / 10 : 0.5,
            nearestCluster: cluster,
            distanceToCentroid: dist,
          };
        });

        result.sort((a, b) => b.blendedScore - a.blendedScore);
        setRankedResults(result);

        // Cache the reranking for offline fallback
        try {
          await savePreferenceRanking({
            venueIds: result.map((r) => r.id),
            scores: result.map((r) => r.clientScore),
            weights: { serverWeight, clientWeight },
            updatedAt: Date.now(),
          });
        } catch (err) {
          console.error(
            "[usePreferenceReranking] Failed to cache ranking",
            err,
          );
        }

        return result;
      } catch {
        // Fallback: server-only ranking
        const fallback = venues.map((venue) => ({
          original: venue,
          id: venue.id,
          serverScore: (venue.score ?? 5) / 10,
          clientScore: 0.5,
          blendedScore: (venue.score ?? 5) / 10,
          nearestCluster: 0,
          distanceToCentroid: 0,
        }));
        fallback.sort((a, b) => b.blendedScore - a.blendedScore);
        setRankedResults(fallback);
        return fallback;
      }
    },
    [centroids, serverWeight, clientWeight],
  );

  const setPreferences = useCallback((prefs: PreferenceVector[]) => {
    preferencesRef.current = prefs;
  }, []);

  const userVector = useMemo(() => {
    return buildUserPreferenceVector(MOCK_HISTORY);
  }, []); // Recompute if history changes (in a real app)

  const rerankedResults = useMemo(() => {
    if (!personalizationEnabled) {
      // Just map to RerankedVenue shape without changing order
      return results.map(
        (v) =>
          ({ ...v, similarityScore: 0, isRecommended: false }) as RerankedVenue,
      );
    }
    return rerankVenues(results, userVector);
  }, [results, userVector, personalizationEnabled]);

  return {
    rerankedResults,
    personalizationEnabled,
    togglePersonalization,
  };
}
