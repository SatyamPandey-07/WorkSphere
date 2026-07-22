import {
  euclideanDistance,
  squaredEuclideanDistance,
  meanVector,
  createZeroVector,
  createNeutralVector,
  cloneVector,
  vectorsEqual,
  hasConverged,
  nearestCentroidIndex,
  assignClusters,
  kmeansppInit,
  clamp01,
  isValidVector,
} from "../../../lib/kmeans/mathUtils";
import { KMEANS_DIMENSIONS } from "../../../lib/kmeans/types";
import type { AmenityVector } from "../../../lib/kmeans/types";

function makeVector(values: number[]): AmenityVector {
  const vec = {} as AmenityVector;
  KMEANS_DIMENSIONS.forEach((dim, i) => {
    vec[dim] = values[i] ?? 0;
  });
  return vec;
}

function allZeros(): AmenityVector {
  return makeVector(KMEANS_DIMENSIONS.map(() => 0));
}

function allOnes(): AmenityVector {
  return makeVector(KMEANS_DIMENSIONS.map(() => 1));
}

describe("K-Means Math Utilities", () => {
  describe("euclideanDistance", () => {
    it("returns 0 for identical vectors", () => {
      const v = makeVector([
        0.5, 0.3, 0.8, 0.1, 0.9, 0.2, 0.6, 0.4, 0.7, 0.5, 0.3, 0.6,
      ]);
      expect(euclideanDistance(v, v)).toBe(0);
    });

    it("returns sqrt(12) for zero vs ones vector", () => {
      expect(euclideanDistance(allZeros(), allOnes())).toBeCloseTo(
        Math.sqrt(12),
        10,
      );
    });

    it("is symmetric", () => {
      const a = makeVector([
        0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.1, 0.2, 0.3,
      ]);
      const b = makeVector([
        0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.9, 0.8, 0.7,
      ]);
      expect(euclideanDistance(a, b)).toBeCloseTo(euclideanDistance(b, a), 10);
    });
  });

  describe("squaredEuclideanDistance", () => {
    it("returns 0 for identical vectors", () => {
      expect(squaredEuclideanDistance(allOnes(), allOnes())).toBe(0);
    });

    it("equals squared euclidean distance", () => {
      const a = allZeros();
      const b = allOnes();
      expect(squaredEuclideanDistance(a, b)).toBeCloseTo(
        Math.pow(euclideanDistance(a, b), 2),
        10,
      );
    });
  });

  describe("meanVector", () => {
    it("returns zero vector for empty input", () => {
      expect(meanVector([])).toEqual(allZeros());
    });

    it("returns the vector itself for single input", () => {
      const v = allOnes();
      expect(meanVector([v])).toEqual(v);
    });

    it("computes correct mean of two vectors", () => {
      const result = meanVector([allZeros(), allOnes()]);
      for (const dim of KMEANS_DIMENSIONS) {
        expect(result[dim]).toBeCloseTo(0.5, 10);
      }
    });
  });

  describe("createZeroVector", () => {
    it("creates a vector with all zeros", () => {
      const v = createZeroVector();
      for (const dim of KMEANS_DIMENSIONS) {
        expect(v[dim]).toBe(0);
      }
    });
  });

  describe("createNeutralVector", () => {
    it("creates a vector centered around 0.5", () => {
      const v = createNeutralVector(0);
      for (const dim of KMEANS_DIMENSIONS) {
        expect(v[dim]).toBeCloseTo(0.5, 10);
      }
    });

    it("is deterministic with seeded RNG", () => {
      const v1 = createNeutralVector(0.05, () => 0.5);
      const v2 = createNeutralVector(0.05, () => 0.5);
      expect(v1).toEqual(v2);
    });
  });

  describe("cloneVector", () => {
    it("creates an independent copy", () => {
      const original = allOnes();
      const clone = cloneVector(original);
      expect(clone).toEqual(original);
      clone.wifiQuality = 0;
      expect(original.wifiQuality).toBe(1);
    });
  });

  describe("vectorsEqual", () => {
    it("returns true for identical vectors", () => {
      const v = allOnes();
      expect(vectorsEqual(v, v)).toBe(true);
    });

    it("returns false for different vectors", () => {
      expect(vectorsEqual(allZeros(), allOnes())).toBe(false);
    });
  });

  describe("hasConverged", () => {
    it("returns true when centroids are identical", () => {
      const c = [allZeros(), allOnes()];
      expect(hasConverged(c, c, 1e-4)).toBe(true);
    });

    it("returns false when centroids differ", () => {
      expect(hasConverged([allZeros()], [allOnes()], 1e-4)).toBe(false);
    });

    it("returns false for different length arrays", () => {
      expect(hasConverged([allZeros()], [allZeros(), allOnes()], 1e-4)).toBe(
        false,
      );
    });
  });

  describe("nearestCentroidIndex", () => {
    it("returns correct nearest centroid", () => {
      const centroids = [allZeros(), allOnes()];
      expect(nearestCentroidIndex(allZeros(), centroids)).toBe(0);
      expect(nearestCentroidIndex(allOnes(), centroids)).toBe(1);
    });

    it("returns -1 for empty centroids", () => {
      expect(nearestCentroidIndex(allZeros(), [])).toBe(-1);
    });
  });

  describe("assignClusters", () => {
    it("assigns vectors to correct clusters", () => {
      const centroids = [allZeros(), allOnes()];
      const assignments = assignClusters([allZeros(), allOnes()], centroids);
      expect(assignments[0]).toBe(0);
      expect(assignments[1]).toBe(1);
    });
  });

  describe("kmeansppInit", () => {
    it("returns empty array for empty input", () => {
      expect(kmeansppInit([], 5)).toEqual([]);
    });

    it("returns all vectors if fewer than k", () => {
      const vectors = [allZeros(), allOnes()];
      expect(kmeansppInit(vectors, 5)).toHaveLength(2);
    });

    it("returns exactly k centroids for sufficient input", () => {
      const vectors = Array.from({ length: 20 }, (_, i) =>
        makeVector(KMEANS_DIMENSIONS.map(() => i / 20)),
      );
      expect(kmeansppInit(vectors, 5)).toHaveLength(5);
    });

    it("returns independent copies", () => {
      const vectors = [allZeros(), allOnes()];
      const result = kmeansppInit(vectors, 2);
      result[0].wifiQuality = 999;
      expect(vectors[0].wifiQuality).toBe(0);
    });

    it("is deterministic with seeded RNG", () => {
      const vectors = Array.from({ length: 20 }, (_, i) =>
        makeVector(KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );
      let seed = 42;
      const rng = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const r1 = kmeansppInit(vectors, 5, rng);
      seed = 42;
      const r2 = kmeansppInit(vectors, 5, rng);
      expect(r1).toEqual(r2);
    });
  });

  describe("clamp01", () => {
    it("clamps values to [0, 1]", () => {
      expect(clamp01(-1)).toBe(0);
      expect(clamp01(0.5)).toBe(0.5);
      expect(clamp01(2)).toBe(1);
    });
  });

  describe("isValidVector", () => {
    it("returns true for valid vectors", () => {
      expect(isValidVector(allOnes())).toBe(true);
    });

    it("returns false for null/undefined", () => {
      expect(isValidVector(null)).toBe(false);
      expect(isValidVector(undefined)).toBe(false);
    });

    it("returns false for vectors with out-of-range values", () => {
      const v = allZeros();
      v.wifiQuality = -0.5;
      expect(isValidVector(v)).toBe(false);
    });
  });
});
