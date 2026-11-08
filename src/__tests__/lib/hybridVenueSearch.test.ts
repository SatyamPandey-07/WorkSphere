import {
  DEFAULT_RRF_K,
  validateAndClampRrfK,
  calculateRrfScore,
  computeL2Norm,
  isZeroNormVector,
  normalizeVector,
  cosineSimilarity,
  searchVenuesWithRrf,
} from "@/lib/search/hybridVenueSearch";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  },
}));

describe("Reciprocal Rank Fusion (RRF) Formula & Boundary Guards (#5603)", () => {
  describe("validateAndClampRrfK", () => {
    it("returns default k = 60 when k is undefined, null, NaN, or non-finite", () => {
      expect(validateAndClampRrfK()).toBe(DEFAULT_RRF_K);
      expect(validateAndClampRrfK(undefined)).toBe(60);
      expect(validateAndClampRrfK(NaN)).toBe(60);
      expect(validateAndClampRrfK(Infinity)).toBe(60);
      expect(validateAndClampRrfK(-Infinity)).toBe(60);
    });

    it("clamps zero and negative values of k to minimum 1", () => {
      expect(validateAndClampRrfK(0)).toBe(1);
      expect(validateAndClampRrfK(-1)).toBe(1);
      expect(validateAndClampRrfK(-60)).toBe(1);
      expect(validateAndClampRrfK(-999)).toBe(1);
    });

    it("floors positive non-integer values of k and respects valid integer k >= 1", () => {
      expect(validateAndClampRrfK(1)).toBe(1);
      expect(validateAndClampRrfK(20)).toBe(20);
      expect(validateAndClampRrfK(60)).toBe(60);
      expect(validateAndClampRrfK(100)).toBe(100);
      expect(validateAndClampRrfK(20.8)).toBe(20);
      expect(validateAndClampRrfK(0.75)).toBe(1);
    });
  });

  describe("calculateRrfScore", () => {
    it("computes exact standard RRF score: weight / (k + rank)", () => {
      // rank 1 with k=60, weight=1 => 1 / 61
      expect(calculateRrfScore(1, 60, 1)).toBeCloseTo(1 / 61, 6);

      // rank 2 with k=60, weight=1 => 1 / 62
      expect(calculateRrfScore(2, 60, 1)).toBeCloseTo(1 / 62, 6);

      // rank 1 with k=20, weight=0.5 => 0.5 / 21
      expect(calculateRrfScore(1, 20, 0.5)).toBeCloseTo(0.5 / 21, 6);
    });

    it("guards against division by zero when k is 0 or negative by clamping k to 1", () => {
      const scoreWithZeroK = calculateRrfScore(1, 0, 1);
      expect(Number.isFinite(scoreWithZeroK)).toBe(true);
      expect(scoreWithZeroK).toBeCloseTo(1 / (1 + 1), 6);

      const scoreWithNegativeK = calculateRrfScore(1, -10, 1);
      expect(Number.isFinite(scoreWithNegativeK)).toBe(true);
      expect(scoreWithNegativeK).toBeCloseTo(1 / (1 + 1), 6);
    });

    it("guards against zero or negative ranks by returning 0", () => {
      expect(calculateRrfScore(0, 60, 1)).toBe(0);
      expect(calculateRrfScore(-1, 60, 1)).toBe(0);
      expect(calculateRrfScore(-100, 60, 1)).toBe(0);
    });

    it("guards against null, undefined, NaN, and non-finite ranks by returning 0", () => {
      expect(calculateRrfScore(null, 60, 1)).toBe(0);
      expect(calculateRrfScore(undefined, 60, 1)).toBe(0);
      expect(calculateRrfScore(NaN, 60, 1)).toBe(0);
      expect(calculateRrfScore(Infinity, 60, 1)).toBe(0);
    });

    it("floors non-integer ranks properly", () => {
      expect(calculateRrfScore(1.9, 60, 1)).toBe(calculateRrfScore(1, 60, 1));
      expect(calculateRrfScore(2.5, 60, 1)).toBe(calculateRrfScore(2, 60, 1));
      expect(calculateRrfScore(0.8, 60, 1)).toBe(0);
    });

    it("guards against negative or non-finite weights", () => {
      expect(calculateRrfScore(1, 60, -0.5)).toBe(0);
      expect(calculateRrfScore(1, 60, NaN)).toBe(0);
      expect(calculateRrfScore(1, 60, Infinity)).toBe(0);
    });
  });

  describe("Zero-Norm Query Vector Detection and Fallback (#5738)", () => {
    describe("computeL2Norm", () => {
      it("computes the exact Euclidean L2 norm of a vector", () => {
        expect(computeL2Norm([3, 4])).toBeCloseTo(5.0, 6);
        expect(computeL2Norm([1, 1, 1, 1])).toBeCloseTo(2.0, 6);
      });

      it("returns 0 for all-zero vectors or empty arrays", () => {
        expect(computeL2Norm([0, 0, 0])).toBe(0);
        expect(computeL2Norm([])).toBe(0);
        expect(computeL2Norm(new Array(1024).fill(0))).toBe(0);
      });
    });

    describe("isZeroNormVector", () => {
      it("returns true when vector norm is below epsilon (1e-7)", () => {
        expect(isZeroNormVector([0, 0, 0])).toBe(true);
        expect(isZeroNormVector(new Array(1024).fill(0))).toBe(true);
        expect(isZeroNormVector([1e-8, -1e-8])).toBe(true);
        expect(isZeroNormVector(null)).toBe(true);
        expect(isZeroNormVector(undefined)).toBe(true);
        expect(isZeroNormVector([])).toBe(true);
      });

      it("returns false when vector norm is >= epsilon", () => {
        expect(isZeroNormVector([1, 0, 0])).toBe(false);
        expect(isZeroNormVector([1e-6, 0])).toBe(false);
        expect(isZeroNormVector([0.1, 0.2, 0.3])).toBe(false);
      });
    });

    describe("normalizeVector", () => {
      it("normalizes a valid non-zero vector to unit L2 norm", () => {
        const normalized = normalizeVector([3, 4]);
        expect(normalized).toBeDefined();
        expect(normalized![0]).toBeCloseTo(0.6, 6);
        expect(normalized![1]).toBeCloseTo(0.8, 6);
        expect(computeL2Norm(normalized!)).toBeCloseTo(1.0, 6);
      });

      it("returns null for zero-norm vectors to prevent NaN", () => {
        expect(normalizeVector([0, 0, 0])).toBeNull();
        expect(normalizeVector(new Array(1024).fill(0))).toBeNull();
        expect(normalizeVector([1e-8, 1e-8])).toBeNull();
      });
    });

    describe("cosineSimilarity", () => {
      it("computes exact cosine similarity between non-zero vectors", () => {
        expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1.0, 6);
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 6);
        expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 6);
      });

      it("guards against zero-norm vectors and returns 0 instead of NaN", () => {
        const zeroVec = [0, 0, 0];
        const nonZeroVec = [1, 2, 3];

        expect(cosineSimilarity(zeroVec, nonZeroVec)).toBe(0);
        expect(cosineSimilarity(nonZeroVec, zeroVec)).toBe(0);
        expect(cosineSimilarity(zeroVec, zeroVec)).toBe(0);
        expect(Number.isNaN(cosineSimilarity(zeroVec, nonZeroVec))).toBe(false);
      });
    });

    describe("searchVenuesWithRrf zero-vector fallback", () => {
      beforeEach(() => {
        jest.clearAllMocks();
      });

      it("falls back exclusively to BM25 full-text results when query embedding is zero-norm", async () => {
        const mockVenues = [
          { id: "venue-1", score: 0.01639, needs_embedding: false },
          { id: "venue-2", score: 0.01612, needs_embedding: false },
        ];
        (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockVenues);

        const allZerosEmbedding = new Array(1024).fill(0);
        const results = await searchVenuesWithRrf("rare oov term", {
          queryEmbedding: allZerosEmbedding,
          semanticWeight: 0.7,
          fullTextWeight: 0.3,
        });

        expect(results).toEqual(mockVenues);
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

        const querySql = (prisma.$queryRaw as jest.Mock).mock.calls[0][0];
        // In the parameterized values, query_embedding parameter should be NULL
        // because embeddingString was set to null when norm < 1e-7 was detected
        expect(querySql.values).toContain(null);

        // Also check that the fullTextWeight was adjusted to 1.0 and semanticWeight to 0.0
        expect(querySql.values).toContain(1.0);
        expect(querySql.values).toContain(0.0);
      });

      it("processes valid normalized non-zero vector and includes embedding in query", async () => {
        const mockVenues = [{ id: "venue-1", score: 0.03, needs_embedding: false }];
        (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockVenues);

        const validVector = [3, 4];
        const results = await searchVenuesWithRrf("coffee shop", {
          queryEmbedding: validVector,
          semanticWeight: 0.5,
          fullTextWeight: 0.5,
        });

        expect(results).toEqual(mockVenues);
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

        const querySql = (prisma.$queryRaw as jest.Mock).mock.calls[0][0];
        // The normalized vector string should be passed to the query
        const expectedNormString = `[${[3 / 5, 4 / 5].join(",")}]`;
        expect(querySql.values).toContain(expectedNormString);
      });
    });
  });
});
