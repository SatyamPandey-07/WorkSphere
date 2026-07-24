/**
 * Federated Preference Re-ranking Engine (#1270)
 *
 * Client-side hook that computes 5-cluster centroids from local amenity
 * preference vectors, calculates Euclidean distance between the user's
 * centroid and venue amenity vectors, and re-sorts search API results
 * without transmitting any user data to the server.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  type AmenityVector,
  type ClusterCentroids,
  KMEANS_DIMENSIONS,
  NUM_CLUSTERS,
  SERVER_SCORE_WEIGHT,
  CLIENT_SCORE_WEIGHT,
  CENTROID_STORAGE_VERSION,
} from "@/lib/kmeans/types";
import { getKMeansClustering } from "@/lib/kmeans/kmeans";
import {
  euclideanDistance,
  nearestCentroidIndex,
  createNeutralVector,
  createZeroVector,
} from "@/lib/kmeans/mathUtils";
import { venueToVector } from "@/lib/kmeans/vectorUtils";

// ============================================================
// Types
// ============================================================

export interface PreferenceVector {
  readonly id: string;
  readonly vector: AmenityVector;
}

export interface RerankedVenue<T = Record<string, unknown>> {
  readonly original: T;
  readonly id: string;
  readonly serverScore: number;
  readonly clientScore: number;
  readonly blendedScore: number;
  readonly nearestCluster: number;
  readonly distanceToCentroid: number;
}

export interface UsePreferenceRerankingOptions {
  /** Maximum number of clusters to compute (default: 5) */
  k?: number;
  /** Weight for server-side score in the blended ranking (default: 0.6) */
  serverWeight?: number;
  /** Weight for client-side preference score (default: 0.4) */
  clientWeight?: number;
  /** Debounce ms for centroid recomputation (default: 500) */
  debounceMs?: number;
}

export interface UsePreferenceRerankingReturn<T> {
  /** Whether the clustering engine is initialized and ready */
  isReady: boolean;
  /** Current centroid data, null if not yet computed */
  centroids: ClusterCentroids | null;
  /** Whether centroids are currently being recomputed */
  isRecomputing: boolean;
  /** The re-ranked results, empty if no venues provided */
  rankedResults: Array<RerankedVenue<T>>;
  /** Re-rank a set of venues against current centroids */
  rankVenues: (venues: T[]) => Promise<Array<RerankedVenue<T>>>;
  /** Force a recompute of centroids from current preference vectors */
  recompute: () => Promise<void>;
  /** Update the preference vectors (e.g. when favorites change) */
  setPreferences: (prefs: PreferenceVector[]) => void;
  /** Clean up the worker */
  terminate: () => void;
}

// ============================================================
// Storage key for offline centroid caching
// ============================================================

const PREFERENCE_STORAGE_KEY = "worksphere:preference-centroids";

// ============================================================
// Hook
// ============================================================

export function usePreferenceReranking<T extends { id: string; score?: number }>(
  preferences: PreferenceVector[],
  options: UsePreferenceRerankingOptions = {},
): UsePreferenceRerankingReturn<T> {
  const {
    k = NUM_CLUSTERS,
    serverWeight = SERVER_SCORE_WEIGHT,
    clientWeight = CLIENT_SCORE_WEIGHT,
    debounceMs = 500,
  } = options;

  const [centroids, setCentroids] = useState<ClusterCentroids | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [rankedResults, setRankedResults] = useState<Array<RerankedVenue<T>>>(
    [],
  );

  const preferencesRef = useRef(preferences);
  const engineRef = useRef(getKMeansClustering());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVenuesRef = useRef<T[]>([]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    const engine = engineRef.current;
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      engine.terminate();
    };
  }, []);

  // Load cached centroids from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PREFERENCE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ClusterCentroids;
        if (
          parsed &&
          parsed.centroids &&
          parsed.k === k &&
          parsed.version === CENTROID_STORAGE_VERSION
        ) {
          setCentroids(parsed);
          setIsReady(true);
        }
      }
    } catch {
      // ignore parse errors
    }
  }, [k]);

  const recompute = useCallback(async () => {
    setIsRecomputing(true);
    try {
      const engine = engineRef.current;
      const vectors = preferencesRef.current.map((p) => p.vector);
      const result = await engine.computeClusters(vectors);
      setCentroids(result);
      setIsReady(true);

      // Persist to localStorage
      try {
        localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(result));
      } catch {
        // ignore quota errors
      }
    } catch (err) {
      console.error("[usePreferenceReranking] Recompute failed:", err);
    } finally {
      setIsRecomputing(false);
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
          const venueVec = venueToVector(r as unknown as Record<string, unknown>);
          const cluster = nearestCentroidIndex(
            venueVec,
            centroids.centroids,
          );
          const dist = euclideanDistance(venueVec, centroids.centroids[cluster]);
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

  const terminate = useCallback(() => {
    engineRef.current.terminate();
  }, []);

  return {
    isReady,
    centroids,
    isRecomputing,
    rankedResults,
    rankVenues,
    recompute,
    setPreferences,
    terminate,
  };
}
