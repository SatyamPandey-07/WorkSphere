import { KMEANS_DIMENSIONS, NUM_CLUSTERS } from "../../../lib/kmeans/types";
import type { AmenityVector } from "../../../lib/kmeans/types";

// Mock Worker and import.meta for Jest CJS environment
const mockPostMessage = jest.fn();
const mockTerminate = jest.fn();

class MockWorker {
  url: string | URL;

  constructor(url: string | URL) {
    this.url = url;
  }

  postMessage(msg: unknown) {
    mockPostMessage(msg);
  }

  terminate() {
    mockTerminate();
  }
}

// @ts-expect-error - mock for test environment
globalThis.Worker = MockWorker;
Object.defineProperty(globalThis, "import.meta", {
  value: { url: "http://localhost/test" },
});

function makeVector(values: number[]): AmenityVector {
  const vec = {} as AmenityVector;
  KMEANS_DIMENSIONS.forEach((dim, i) => {
    vec[dim] = values[i] ?? 0;
  });
  return vec;
}

function makeVenue(overrides: Partial<AmenityVector> = {}): AmenityVector {
  const base = {} as AmenityVector;
  for (const dim of KMEANS_DIMENSIONS) {
    base[dim] = 0.5;
  }
  return { ...base, ...overrides };
}

// Must import AFTER mocking
import { FederatedKMeansClustering } from "../../../lib/kmeans/kmeans";

describe("Federated K-Means Clustering Engine", () => {
  let engine: FederatedKMeansClustering;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new FederatedKMeansClustering();
  });

  afterEach(() => {
    engine.terminate();
  });

  describe("computeClusters", () => {
    it("returns exactly K centroids", async () => {
      const vectors = Array.from({ length: 20 }, (_, i) =>
        makeVector(KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );
      const result = await engine.computeClusters(vectors);
      expect(result.centroids).toHaveLength(NUM_CLUSTERS);
      expect(result.k).toBe(NUM_CLUSTERS);
    });

    it("handles empty input gracefully", async () => {
      const result = await engine.computeClusters([]);
      expect(result.centroids).toHaveLength(NUM_CLUSTERS);
      expect(result.dataPoints).toBe(0);
    });

    it("handles fewer vectors than K", async () => {
      const vectors = [
        makeVenue({ wifiQuality: 0.9 }),
        makeVenue({ wifiQuality: 0.1 }),
      ];
      const result = await engine.computeClusters(vectors);
      expect(result.centroids).toHaveLength(NUM_CLUSTERS);
      expect(result.dataPoints).toBe(2);
    });

    it("produces distinct centroids for diverse input", async () => {
      const vectors = [
        ...Array.from({ length: 10 }, () =>
          makeVenue({ wifiQuality: 0.9, hasOutlets: 0.9 }),
        ),
        ...Array.from({ length: 10 }, () =>
          makeVenue({ wifiQuality: 0.1, hasOutlets: 0.1 }),
        ),
      ];
      const result = await engine.computeClusters(vectors);
      expect(result.centroids).toHaveLength(NUM_CLUSTERS);
      const uniqueHashes = new Set(
        result.centroids.map((c) =>
          KMEANS_DIMENSIONS.map((d) => c[d].toFixed(4)).join(","),
        ),
      );
      expect(uniqueHashes.size).toBeGreaterThan(1);
    });

    it("filters invalid vectors", async () => {
      const vectors = [
        makeVenue({ wifiQuality: 0.9 }),
        { wifiQuality: NaN } as unknown as AmenityVector,
        makeVenue({ wifiQuality: 0.1 }),
      ];
      const result = await engine.computeClusters(vectors);
      expect(result.dataPoints).toBe(2);
    });

    it("all centroids have valid values", async () => {
      const vectors = Array.from({ length: 15 }, (_, i) =>
        makeVector(KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );
      const result = await engine.computeClusters(vectors);
      for (const centroid of result.centroids) {
        for (const dim of KMEANS_DIMENSIONS) {
          expect(centroid[dim]).not.toBeNaN();
          expect(centroid[dim]).toBeGreaterThanOrEqual(0);
          expect(centroid[dim]).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe("rankVenues", () => {
    it("returns empty array for empty input", async () => {
      await engine.computeClusters([makeVenue()]);
      const result = await engine.rankVenues([]);
      expect(result).toEqual([]);
    });

    it("returns original order when no centroids exist", async () => {
      const venues = [
        { id: "v1", score: 5 },
        { id: "v2", score: 8 },
      ];
      const result = await engine.rankVenues(venues);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("v1");
      expect(result[1].id).toBe("v2");
    });

    it("returns ranked results after computing clusters", async () => {
      const vectors = Array.from({ length: 20 }, (_, i) =>
        makeVector(KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );
      await engine.computeClusters(vectors);

      const venues = Array.from({ length: 10 }, (_, i) => ({
        id: `v${i}`,
        score: i,
      }));

      const result = await engine.rankVenues(venues);
      expect(result).toHaveLength(10);
      for (const r of result) {
        expect(typeof r.clusterScore).toBe("number");
        expect(typeof r.cluster).toBe("number");
      }
    });

    it("results are sorted by blended score descending", async () => {
      const vectors = Array.from({ length: 20 }, (_, i) =>
        makeVector(KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );
      await engine.computeClusters(vectors);

      const venues = Array.from({ length: 10 }, (_, i) => ({
        id: `v${i}`,
        score: i,
      }));

      const result = await engine.rankVenues(venues);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].score ?? 0).toBeLessThanOrEqual(
          result[i - 1].score ?? 0,
        );
      }
    });

    it("respects custom blend weights", async () => {
      const vectors = Array.from({ length: 20 }, (_, i) =>
        makeVector(KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );
      await engine.computeClusters(vectors);

      const venues = [
        { id: "v1", score: 1 },
        { id: "v2", score: 9 },
      ];

      const serverOnly = await engine.rankVenues(venues, 1.0, 0.0);
      const clientOnly = await engine.rankVenues(venues, 0.0, 1.0);

      expect(serverOnly[0].id).toBe("v2");
      expect(serverOnly[1].id).toBe("v1");
      expect(clientOnly).toHaveLength(2);
    });
  });

  describe("getCentroids", () => {
    it("returns null before computation", () => {
      expect(engine.getCentroids()).toBeNull();
    });

    it("returns centroids after computation", async () => {
      const vectors = Array.from({ length: 10 }, (_, i) =>
        makeVector(KMEANS_DIMENSIONS.map(() => (i % 5) / 5)),
      );
      await engine.computeClusters(vectors);
      const centroids = engine.getCentroids();
      expect(centroids).not.toBeNull();
      expect(centroids!.centroids).toHaveLength(NUM_CLUSTERS);
    });
  });

  describe("terminate", () => {
    it("can be called multiple times safely", () => {
      engine.terminate();
      engine.terminate();
    });
  });
});
