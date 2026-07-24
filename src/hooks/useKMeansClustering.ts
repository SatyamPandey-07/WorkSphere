/**
 * React hook for federated K-Means clustering (#1127)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  type AmenityVector,
  type ClusterCentroids,
  SERVER_SCORE_WEIGHT,
  CLIENT_SCORE_WEIGHT,
} from "@/lib/kmeans/types";
import { getKMeansClustering } from "@/lib/kmeans/kmeans";
import { venueToVector, deduplicateVectors } from "@/lib/kmeans/vectorUtils";

interface SavedVenueLike {
  id: string;
  venueId: string;
  venue: {
    id: string;
    rating?: number | null;
    wifiQuality?: number | null;
    hasOutlets?: boolean | null;
    noiseLevel?: string | null;
    outletDensity?: string | null;
    hasErgonomic?: boolean | null;
    hasPhoneBooths?: boolean | null;
    hasNoMusic?: boolean | null;
    hasQuietZone?: boolean | null;
    hasAncHeadsetRental?: boolean | null;
    lighting?: string | null;
    currentOccupancy?: number | null;
  };
}

interface UseKMeansClusteringReturn {
  isReady: boolean;
  centroids: ClusterCentroids | null;
  isRecomputing: boolean;
  rankVenues: <T extends { id: string; score?: number }>(
    venues: T[],
  ) => Promise<Array<T & { clusterScore: number; cluster: number }>>;
  recompute: () => Promise<void>;
  terminate: () => void;
}

const RECOMPUTE_DEBOUNCE_MS = 500;

export function useKMeansClustering(
  favorites: SavedVenueLike[],
): UseKMeansClusteringReturn {
  const [centroids, setCentroids] = useState<ClusterCentroids | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const favoritesRef = useRef(favorites);
  const engineRef = useRef(getKMeansClustering());

  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);

  useEffect(() => {
    const engine = engineRef.current;
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      engine.terminate();
    };
  }, []);

  const extractVectors = useCallback(
    (favs: SavedVenueLike[]): AmenityVector[] => {
      const items = favs.map((fav) => ({
        id: fav.venueId,
        vector: venueToVector(fav.venue),
      }));
      return deduplicateVectors(items).map((item) => item.vector);
    },
    [],
  );

  const recompute = useCallback(async () => {
    setIsRecomputing(true);
    try {
      const engine = engineRef.current;
      const vectors = extractVectors(favoritesRef.current);
      const result = await engine.computeClusters(vectors);
      setCentroids(result);
      setIsReady(true);
    } catch (err) {
      console.error("[useKMeansClustering] Recompute failed:", err);
    } finally {
      setIsRecomputing(false);
    }
  }, [extractVectors]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void recompute();
    }, RECOMPUTE_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [favorites, recompute]);

  const rankVenues = useCallback(
    async <T extends { id: string; score?: number }>(
      venues: T[],
    ): Promise<Array<T & { clusterScore: number; cluster: number }>> => {
      const engine = engineRef.current;
      return engine.rankVenues<T>(
        venues,
        SERVER_SCORE_WEIGHT,
        CLIENT_SCORE_WEIGHT,
      );
    },
    [],
  );

  const terminate = useCallback(() => {
    engineRef.current.terminate();
  }, []);

  return {
    isReady,
    centroids,
    isRecomputing,
    rankVenues,
    recompute,
    terminate,
  };
}
