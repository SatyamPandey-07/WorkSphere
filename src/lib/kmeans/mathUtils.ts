/**
 * Vector math utilities for K-Means clustering (#1127)
 */

import { type AmenityVector, KMEANS_DIMENSIONS } from "./types";

export function euclideanDistance(a: AmenityVector, b: AmenityVector): number {
  let sum = 0;
  for (const dim of KMEANS_DIMENSIONS) {
    const diff = a[dim] - b[dim];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function squaredEuclideanDistance(
  a: AmenityVector,
  b: AmenityVector,
): number {
  let sum = 0;
  for (const dim of KMEANS_DIMENSIONS) {
    const diff = a[dim] - b[dim];
    sum += diff * diff;
  }
  return sum;
}

export function meanVector(vectors: AmenityVector[]): AmenityVector {
  const result = createZeroVector();
  if (vectors.length === 0) return result;
  for (const vec of vectors) {
    for (const dim of KMEANS_DIMENSIONS) {
      result[dim] += vec[dim];
    }
  }
  const n = vectors.length;
  for (const dim of KMEANS_DIMENSIONS) {
    result[dim] /= n;
  }
  return result;
}

export function createZeroVector(): AmenityVector {
  const vec = {} as AmenityVector;
  for (const dim of KMEANS_DIMENSIONS) {
    vec[dim] = 0;
  }
  return vec;
}

export function createNeutralVector(
  jitter: number = 0.05,
  rng: () => number = Math.random,
): AmenityVector {
  const vec = {} as AmenityVector;
  for (const dim of KMEANS_DIMENSIONS) {
    const offset = (rng() - 0.5) * 2 * jitter;
    vec[dim] = clamp01(0.5 + offset);
  }
  return vec;
}

export function cloneVector(v: AmenityVector): AmenityVector {
  const clone = {} as AmenityVector;
  for (const dim of KMEANS_DIMENSIONS) {
    clone[dim] = v[dim];
  }
  return clone;
}

export function vectorsEqual(
  a: AmenityVector,
  b: AmenityVector,
  tolerance: number = 1e-9,
): boolean {
  for (const dim of KMEANS_DIMENSIONS) {
    if (Math.abs(a[dim] - b[dim]) > tolerance) return false;
  }
  return true;
}

export function hasConverged(
  oldCentroids: AmenityVector[],
  newCentroids: AmenityVector[],
  threshold: number,
): boolean {
  if (oldCentroids.length !== newCentroids.length) return false;
  for (let i = 0; i < oldCentroids.length; i++) {
    if (squaredEuclideanDistance(oldCentroids[i], newCentroids[i]) > threshold)
      return false;
  }
  return true;
}

export function nearestCentroidIndex(
  vector: AmenityVector,
  centroids: AmenityVector[],
): number {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const dist = squaredEuclideanDistance(vector, centroids[i]);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function assignClusters(
  vectors: AmenityVector[],
  centroids: AmenityVector[],
): number[] {
  return vectors.map((v) => nearestCentroidIndex(v, centroids));
}

/**
 * K-Means++ initialization for selecting initial centroids.
 */
export function kmeansppInit(
  vectors: AmenityVector[],
  k: number,
  rng: () => number = Math.random,
): AmenityVector[] {
  if (vectors.length === 0) return [];
  if (vectors.length <= k) return vectors.map(cloneVector);

  const centroids: AmenityVector[] = [];
  const firstIdx = Math.floor(rng() * vectors.length);
  centroids.push(cloneVector(vectors[firstIdx]));

  const distances = new Float64Array(vectors.length);

  for (let c = 1; c < k; c++) {
    for (let i = 0; i < vectors.length; i++) {
      const dist = squaredEuclideanDistance(vectors[i], centroids[c - 1]);
      if (c === 1 || dist < distances[i]) {
        distances[i] = dist;
      }
    }

    let totalDist = 0;
    for (let i = 0; i < vectors.length; i++) {
      totalDist += distances[i];
    }

    if (totalDist === 0) {
      const idx = Math.floor(rng() * vectors.length);
      centroids.push(cloneVector(vectors[idx]));
      continue;
    }

    const target = rng() * totalDist;
    let cumulative = 0;
    let selectedIdx = 0;
    for (let i = 0; i < vectors.length; i++) {
      cumulative += distances[i];
      if (cumulative >= target) {
        selectedIdx = i;
        break;
      }
    }

    centroids.push(cloneVector(vectors[selectedIdx]));
  }

  return centroids;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function isValidVector(vector: unknown): vector is AmenityVector {
  if (typeof vector !== "object" || vector === null) return false;
  const obj = vector as Record<string, unknown>;
  for (const dim of KMEANS_DIMENSIONS) {
    const val = obj[dim];
    if (typeof val !== "number" || !isFinite(val) || val < 0 || val > 1) {
      return false;
    }
  }
  return true;
}
