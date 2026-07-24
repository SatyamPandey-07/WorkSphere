/**
 * Federated K-Means Clustering Types (#1127)
 *
 * Defines the feature vector space, centroid storage schema, and
 * Web Worker message protocol for client-side personalized ranking.
 */

export const KMEANS_DIMENSIONS = [
  "wifiQuality",
  "hasOutlets",
  "outletDensity",
  "noiseLevel",
  "hasErgonomic",
  "hasPhoneBooths",
  "hasNoMusic",
  "hasQuietZone",
  "hasAncHeadsetRental",
  "lighting",
  "currentOccupancy",
  "rating",
] as const;

export type AmenityVectorKey = (typeof KMEANS_DIMENSIONS)[number];

/**
 * 12-dimensional normalized amenity feature vector.
 * All values are in [0, 1] range to ensure equal weighting in Euclidean space.
 */
export type AmenityVector = Record<AmenityVectorKey, number>;

export const NUM_CLUSTERS = 5;
export const MAX_ITERATIONS = 50;
export const CONVERGENCE_THRESHOLD = 1e-4;

/**
 * Serialized centroid matrix stored in localStorage.
 * Includes metadata for cache invalidation and integrity verification.
 */
export interface ClusterCentroids {
  readonly centroids: AmenityVector[];
  readonly k: number;
  readonly version: number;
  readonly computedAt: number;
  readonly dataPoints: number;
  readonly hmac: string;
}

/**
 * Persisted storage envelope for centroid data.
 * The raw centroids are signed with an HMAC for integrity protection.
 */
export interface CentroidStoragePayload {
  readonly centroids: AmenityVector[];
  readonly k: number;
  readonly version: number;
  readonly computedAt: number;
  readonly dataPoints: number;
}

/**
 * Ranking blend weights for combining server and client scores.
 */
export const SERVER_SCORE_WEIGHT = 0.6;
export const CLIENT_SCORE_WEIGHT = 0.4;

/**
 * Version identifier for centroid schema compatibility.
 */
export const CENTROID_STORAGE_VERSION = 1;
export const CENTROID_STORAGE_KEY = "worksphere-kmeans-centroids";
export const HMAC_SALT = "worksphere-kmeans-v1";
