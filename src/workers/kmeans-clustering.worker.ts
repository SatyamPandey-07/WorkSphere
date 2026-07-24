/**
 * K-Means Clustering Web Worker (#1127)
 *
 * Runs K-Means++ initialization and Lloyd's Algorithm off the main thread
 * to avoid UI blocking.
 */

import {
  type AmenityVector,
  KMEANS_DIMENSIONS,
  MAX_ITERATIONS,
  CONVERGENCE_THRESHOLD,
  NUM_CLUSTERS,
} from "../lib/kmeans/types";
import {
  kmeansppInit,
  squaredEuclideanDistance,
  nearestCentroidIndex,
  hasConverged,
  createZeroVector,
  createNeutralVector,
} from "../lib/kmeans/mathUtils";
import { padWithNeutralVectors } from "../lib/kmeans/vectorUtils";

// ============================================================
// Message types
// ============================================================

interface InitMessage {
  type: "INIT";
  id: string;
}

interface ComputeClustersMessage {
  type: "COMPUTE_CLUSTERS";
  id: string;
  vectors: AmenityVector[];
}

interface RankVenuesMessage {
  type: "RANK_VENUES";
  id: string;
  venueVectors: Array<{ id: string; vector: AmenityVector }>;
  centroids: AmenityVector[];
}

type WorkerMessage = InitMessage | ComputeClustersMessage | RankVenuesMessage;

// ============================================================
// Response types
// ============================================================

type WorkerResponse =
  | { type: "INIT_SUCCESS"; id: string }
  | {
      type: "CLUSTERS_COMPUTED";
      id: string;
      centroids: AmenityVector[];
      dataPoints: number;
      inertia: number;
    }
  | {
      type: "RANKED_RESULTS";
      id: string;
      ranked: Array<{
        id: string;
        distance: number;
        cluster: number;
        blendedScore: number;
      }>;
    }
  | { type: "ERROR"; id: string; error: string };

// ============================================================
// K-Means++ + Lloyd's Algorithm
// ============================================================

function runKMeans(
  vectors: AmenityVector[],
  k: number = NUM_CLUSTERS,
  maxIter: number = MAX_ITERATIONS,
  convergenceThreshold: number = CONVERGENCE_THRESHOLD,
): { centroids: AmenityVector[]; inertia: number } {
  if (vectors.length === 0) {
    return {
      centroids: Array.from({ length: k }, () => createNeutralVector()),
      inertia: 0,
    };
  }

  const paddedVectors = padWithNeutralVectors(
    vectors,
    Math.max(vectors.length, k),
  );

  let centroids = kmeansppInit(paddedVectors, k);
  let prevCentroids: AmenityVector[] = [];

  for (let iter = 0; iter < maxIter; iter++) {
    const assignments = new Int32Array(paddedVectors.length);
    for (let i = 0; i < paddedVectors.length; i++) {
      assignments[i] = nearestCentroidIndex(paddedVectors[i], centroids);
    }

    prevCentroids = centroids.map((c) => ({ ...c }));

    const clusterCounts = new Array<number>(k).fill(0);
    const clusterSums: AmenityVector[] = Array.from(
      { length: k },
      createZeroVector,
    );

    for (let i = 0; i < paddedVectors.length; i++) {
      const ci = assignments[i];
      clusterCounts[ci]++;
      for (const dim of KMEANS_DIMENSIONS) {
        clusterSums[ci][dim] += paddedVectors[i][dim];
      }
    }

    const newCentroids: AmenityVector[] = [];
    for (let c = 0; c < k; c++) {
      if (clusterCounts[c] === 0) {
        let maxDist = -1;
        let farthestIdx = 0;
        for (let i = 0; i < paddedVectors.length; i++) {
          const dist = squaredEuclideanDistance(
            paddedVectors[i],
            centroids[assignments[i]],
          );
          if (dist > maxDist) {
            maxDist = dist;
            farthestIdx = i;
          }
        }
        newCentroids.push({ ...paddedVectors[farthestIdx] });
      } else {
        const centroid = createZeroVector();
        for (const dim of KMEANS_DIMENSIONS) {
          centroid[dim] = clusterSums[c][dim] / clusterCounts[c];
        }
        newCentroids.push(centroid);
      }
    }

    centroids = newCentroids;

    if (
      iter > 0 &&
      hasConverged(prevCentroids, centroids, convergenceThreshold)
    ) {
      break;
    }
  }

  let inertia = 0;
  for (let i = 0; i < paddedVectors.length; i++) {
    const ci = nearestCentroidIndex(paddedVectors[i], centroids);
    inertia += squaredEuclideanDistance(paddedVectors[i], centroids[ci]);
  }

  return { centroids, inertia };
}

// ============================================================
// Venue ranking
// ============================================================

function rankVenues(
  venueVectors: Array<{ id: string; vector: AmenityVector }>,
  centroids: AmenityVector[],
): Array<{
  id: string;
  distance: number;
  cluster: number;
  blendedScore: number;
}> {
  const maxPossibleDistance = Math.sqrt(KMEANS_DIMENSIONS.length);

  return venueVectors.map(({ id, vector }) => {
    const cluster = nearestCentroidIndex(vector, centroids);
    const dist = Math.sqrt(
      squaredEuclideanDistance(vector, centroids[cluster]),
    );
    const normalizedDistance = Math.min(dist / maxPossibleDistance, 1);
    const blendedScore = 1 - normalizedDistance;

    return { id, distance: dist, cluster, blendedScore };
  });
}

// ============================================================
// Worker message handler
// ============================================================

function postResponse(msg: WorkerResponse): void {
  self.postMessage(msg);
}

self.addEventListener("message", (e: MessageEvent<WorkerMessage>) => {
  try {
    const { type, id } = e.data;

    switch (type) {
      case "INIT": {
        postResponse({ type: "INIT_SUCCESS", id });
        break;
      }

      case "COMPUTE_CLUSTERS": {
        const { vectors } = e.data as ComputeClustersMessage;

        if (!Array.isArray(vectors) || vectors.length === 0) {
          const neutralCentroids = Array.from(
            { length: NUM_CLUSTERS },
            (_, i) => {
              let seed = i * 7919 + 1;
              const rng = () => {
                seed = (seed * 16807 + 0) % 2147483647;
                return seed / 2147483647;
              };
              return createNeutralVector(0.05, rng);
            },
          );
          postResponse({
            type: "CLUSTERS_COMPUTED",
            id,
            centroids: neutralCentroids,
            dataPoints: 0,
            inertia: 0,
          });
          return;
        }

        const validVectors = vectors.filter((v) => {
          if (typeof v !== "object" || v === null) return false;
          for (const dim of KMEANS_DIMENSIONS) {
            const val = (v as Record<string, unknown>)[dim];
            if (typeof val !== "number" || !isFinite(val)) return false;
          }
          return true;
        });

        const { centroids, inertia } = runKMeans(validVectors);

        postResponse({
          type: "CLUSTERS_COMPUTED",
          id,
          centroids,
          dataPoints: validVectors.length,
          inertia,
        });
        break;
      }

      case "RANK_VENUES": {
        const { venueVectors, centroids } = e.data as RankVenuesMessage;

        if (!Array.isArray(venueVectors) || venueVectors.length === 0) {
          postResponse({ type: "RANKED_RESULTS", id, ranked: [] });
          return;
        }

        if (!Array.isArray(centroids) || centroids.length === 0) {
          postResponse({
            type: "RANKED_RESULTS",
            id,
            ranked: venueVectors.map(({ id: vid }) => ({
              id: vid,
              distance: 0,
              cluster: 0,
              blendedScore: 0.5,
            })),
          });
          return;
        }

        const ranked = rankVenues(venueVectors, centroids);
        ranked.sort((a, b) => b.blendedScore - a.blendedScore);

        postResponse({ type: "RANKED_RESULTS", id, ranked });
        break;
      }

      default: {
        postResponse({
          type: "ERROR",
          id,
          error: `Unknown message type: ${(e.data as { type: string }).type}`,
        });
      }
    }
  } catch (err) {
    postResponse({
      type: "ERROR",
      id: (e.data as { id: string })?.id ?? "unknown",
      error: err instanceof Error ? err.message : "Unknown worker error",
    });
  }
});
