/**
 * Federated K-Means Clustering Engine (#1127)
 *
 * Client-side singleton that manages a dedicated WebWorker for K-Means
 * clustering. Provides personalized venue re-ranking based on user amenity
 * preferences without any server-side tracking.
 */

import {
  type AmenityVector,
  type ClusterCentroids,
  CENTROID_STORAGE_VERSION,
  KMEANS_DIMENSIONS,
  NUM_CLUSTERS,
  SERVER_SCORE_WEIGHT,
  CLIENT_SCORE_WEIGHT,
} from "./types";
import {
  euclideanDistance,
  kmeansppInit,
  nearestCentroidIndex,
  squaredEuclideanDistance,
  createZeroVector,
  hasConverged,
  isValidVector,
} from "./mathUtils";
import { padWithNeutralVectors } from "./vectorUtils";
import { loadCentroids, saveCentroids } from "./storage";
import { venuesToVectorArray } from "./reRanking";

// ============================================================
// Worker message types (must match worker)
// ============================================================

interface WorkerMessage {
  type: string;
  id: string;
  [key: string]: unknown;
}

interface WorkerResponse {
  type: string;
  id: string;
  centroids?: AmenityVector[];
  dataPoints?: number;
  inertia?: number;
  ranked?: Array<{
    id: string;
    distance: number;
    cluster: number;
    blendedScore: number;
  }>;
  error?: string;
}

// ============================================================
// Singleton class
// ============================================================

let instance: FederatedKMeansClustering | null = null;

export function getKMeansClustering(): FederatedKMeansClustering {
  if (!instance) {
    instance = new FederatedKMeansClustering();
  }
  return instance;
}

export class FederatedKMeansClustering {
  private worker: Worker | null = null;
  private isInitialized = false;
  private pendingRequests = new Map<
    string,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private messageCounter = 0;
  private centroids: ClusterCentroids | null = null;
  private workerReady = false;

  constructor() {
    this.initWorker();
    void this.loadCachedCentroids();
  }

  private initWorker(): void {
    if (
      typeof window === "undefined" ||
      typeof Worker === "undefined" ||
      (typeof process !== "undefined" && process.env.NODE_ENV === "test")
    ) {
      return;
    }

    try {
      const baseUrl =
        typeof window !== "undefined"
          ? window.location?.href
          : "http://localhost";
      const workerUrl = new URL(
        "../../workers/kmeans-clustering.worker.ts",
        baseUrl,
      );
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        this.handleWorkerResponse(e.data);
      };

      this.worker.onerror = (err) => {
        console.error("[KMeans] Worker error:", err);
        this.workerReady = false;
      };
    } catch (err) {
      console.warn(
        "[KMeans] Worker initialization failed, falling back to main thread:",
        err,
      );
      this.worker = null;
    }
  }

  private handleWorkerResponse(response: WorkerResponse): void {
    const { id, type } = response;

    if (type === "INIT_SUCCESS") {
      this.workerReady = true;
      if (id && this.pendingRequests.has(id)) {
        const { resolve } = this.pendingRequests.get(id)!;
        this.pendingRequests.delete(id);
        resolve(true);
      }
      return;
    }

    if (id && this.pendingRequests.has(id)) {
      const { resolve, reject } = this.pendingRequests.get(id)!;
      this.pendingRequests.delete(id);

      if (type === "ERROR") {
        reject(new Error(response.error || "Worker error"));
      } else {
        resolve(response);
      }
    }
  }

  private postToWorker(message: WorkerMessage): void {
    if (this.worker && this.workerReady) {
      this.worker.postMessage(message);
    }
  }

  private requestFromWorker<T>(message: WorkerMessage): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.worker || !this.workerReady) {
        reject(new Error("Worker not available"));
        return;
      }

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(message.id)) {
          this.pendingRequests.delete(message.id);
          reject(new Error("Worker request timed out"));
        }
      }, 10_000);

      this.pendingRequests.set(message.id, {
        resolve: (val: unknown) => {
          clearTimeout(timeout);
          resolve(val as T);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.postToWorker(message);
    });
  }

  private async loadCachedCentroids(): Promise<void> {
    try {
      this.centroids = await loadCentroids();
    } catch {
      this.centroids = null;
    }
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.worker && !this.workerReady) {
      try {
        const id = `init_${++this.messageCounter}`;
        await this.requestFromWorker<boolean>({ type: "INIT", id });
      } catch {
        // Worker init failed
      }
    }
    this.isInitialized = true;
  }

  async computeClusters(vectors: AmenityVector[]): Promise<ClusterCentroids> {
    await this.init();
    const id = `compute_${++this.messageCounter}`;

    if (this.worker && this.workerReady) {
      try {
        const response = await this.requestFromWorker<WorkerResponse>({
          type: "COMPUTE_CLUSTERS",
          id,
          vectors,
        });

        const centroids: ClusterCentroids = {
          centroids: response.centroids!,
          k: NUM_CLUSTERS,
          version: CENTROID_STORAGE_VERSION,
          computedAt: Date.now(),
          dataPoints: response.dataPoints!,
          hmac: "",
        };

        this.centroids = centroids;
        await saveCentroids(centroids);
        return centroids;
      } catch (err) {
        console.warn(
          "[KMeans] Worker compute failed, falling back to main thread:",
          err,
        );
      }
    }

    return this.computeClustersMainThread(vectors);
  }

  private computeClustersMainThread(
    vectors: AmenityVector[],
  ): ClusterCentroids {
    const validVectors = vectors.filter(isValidVector);
    const paddedVectors = padWithNeutralVectors(
      validVectors,
      Math.max(validVectors.length, NUM_CLUSTERS),
    );

    let centroids = kmeansppInit(paddedVectors, NUM_CLUSTERS);
    let prevCentroids: AmenityVector[] = [];

    for (let iter = 0; iter < 50; iter++) {
      const assignments = paddedVectors.map((v) =>
        nearestCentroidIndex(v, centroids),
      );

      prevCentroids = centroids.map((c) => ({ ...c }));

      const clusterCounts = new Array<number>(NUM_CLUSTERS).fill(0);
      const clusterSums: AmenityVector[] = Array.from(
        { length: NUM_CLUSTERS },
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
      for (let c = 0; c < NUM_CLUSTERS; c++) {
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

      if (iter > 0 && hasConverged(prevCentroids, centroids, 1e-4)) {
        break;
      }
    }

    const result: ClusterCentroids = {
      centroids,
      k: NUM_CLUSTERS,
      version: CENTROID_STORAGE_VERSION,
      computedAt: Date.now(),
      dataPoints: validVectors.length,
      hmac: "",
    };

    this.centroids = result;
    void saveCentroids(result);
    return result;
  }

  async rankVenues<T extends { id: string; score?: number }>(
    venues: T[],
    serverScoreWeight: number = SERVER_SCORE_WEIGHT,
    clientScoreWeight: number = CLIENT_SCORE_WEIGHT,
  ): Promise<Array<T & { clusterScore: number; cluster: number }>> {
    await this.init();

    if (venues.length === 0) return [];
    if (!this.centroids || this.centroids.centroids.length === 0) {
      return venues.map((v) => ({
        ...v,
        clusterScore: v.score ?? 0.5,
        cluster: 0,
      }));
    }

    const venueVectors = venuesToVectorArray(venues);
    const id = `rank_${++this.messageCounter}`;

    if (this.worker && this.workerReady) {
      try {
        const response = await this.requestFromWorker<WorkerResponse>({
          type: "RANK_VENUES",
          id,
          venueVectors: venueVectors.map((v) => ({
            id: v.id,
            vector: v.vector,
          })),
          centroids: this.centroids.centroids,
        });

        const rankedMap = new Map(
          (response.ranked ?? []).map((r) => [r.id, r]),
        );

        const result = venues.map((venue) => {
          const ranked = rankedMap.get(venue.id);
          const clientScore = ranked?.blendedScore ?? 0.5;
          const cluster = ranked?.cluster ?? 0;
          const serverScore = (venue.score ?? 5) / 10;
          const blendedScore =
            serverScore * serverScoreWeight + clientScore * clientScoreWeight;

          return {
            ...venue,
            score: blendedScore * 10,
            clusterScore: clientScore,
            cluster,
          };
        });

        result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        return result;
      } catch (err) {
        console.warn(
          "[KMeans] Worker ranking failed, falling back to main thread:",
          err,
        );
      }
    }

    return this.rankVenuesMainThread(
      venues,
      venueVectors,
      serverScoreWeight,
      clientScoreWeight,
    );
  }

  private rankVenuesMainThread<T extends { id: string; score?: number }>(
    venues: T[],
    venueVectors: Array<{ id: string; vector: AmenityVector }>,
    serverScoreWeight: number,
    clientScoreWeight: number,
  ): Array<T & { clusterScore: number; cluster: number }> {
    const maxPossibleDistance = Math.sqrt(KMEANS_DIMENSIONS.length);
    const venueVectorMap = new Map(venueVectors.map((v) => [v.id, v.vector]));

    const result = venues.map((venue) => {
      const vector = venueVectorMap.get(venue.id);
      if (!vector || !this.centroids) {
        return { ...venue, clusterScore: 0.5, cluster: 0 };
      }

      const cluster = nearestCentroidIndex(vector, this.centroids.centroids);
      const dist = euclideanDistance(vector, this.centroids.centroids[cluster]);
      const normalizedDistance = Math.min(dist / maxPossibleDistance, 1);
      const clientScore = 1 - normalizedDistance;
      const serverScore = (venue.score ?? 5) / 10;
      const blendedScore =
        serverScore * serverScoreWeight + clientScore * clientScoreWeight;

      return {
        ...venue,
        score: blendedScore * 10,
        clusterScore: clientScore,
        cluster,
      };
    });

    result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return result;
  }

  getCentroids(): ClusterCentroids | null {
    return this.centroids;
  }

  async reloadFromStorage(): Promise<ClusterCentroids | null> {
    await this.loadCachedCentroids();
    return this.centroids;
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.isInitialized = false;
    this.workerReady = false;
  }
}
