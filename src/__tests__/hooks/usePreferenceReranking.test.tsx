import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { KMEANS_DIMENSIONS, NUM_CLUSTERS } from "@/lib/kmeans/types";
import type { AmenityVector } from "@/lib/kmeans/types";
import type { PreferenceVector } from "@/hooks/usePreferenceReranking";

// ── Mock Worker ──
const mockPostMessage = jest.fn();
const mockTerminate = jest.fn();

class MockWorker {
  url: string | URL;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;

  constructor(url: string | URL) {
    this.url = url;
    // Simulate INIT success
    setTimeout(() => {
      this.onmessage?.({
        data: { type: "INIT_SUCCESS", id: "init_1" },
      } as MessageEvent);
    }, 0);
  }

  postMessage(msg: unknown) {
    mockPostMessage(msg);
    // Simulate responses for COMPUTE_CLUSTERS
    const m = msg as { type: string; id: string; vectors?: unknown[] };
    if (m.type === "COMPUTE_CLUSTERS") {
      const count = m.vectors?.length ?? 0;
      const centroids = Array.from({ length: NUM_CLUSTERS }, (_, i) => {
        const vec = {} as AmenityVector;
        KMEANS_DIMENSIONS.forEach((dim) => {
          vec[dim] = (i * 0.1 + 0.2) % 1;
        });
        return vec;
      });
      setTimeout(() => {
        this.onmessage?.({
          data: {
            type: "CLUSTERS_COMPUTED",
            id: m.id,
            centroids,
            dataPoints: count,
            inertia: 0.5,
          },
        } as MessageEvent);
      }, 0);
    }
    if (m.type === "RANK_VENUES") {
      const venueVecs = (m as { venueVectors?: Array<{ id: string }> }).venueVectors ?? [];
      setTimeout(() => {
        this.onmessage?.({
          data: {
            type: "RANKED_RESULTS",
            id: m.id,
            ranked: venueVecs.map((v, i) => ({
              id: v.id,
              distance: i * 0.1,
              cluster: i % NUM_CLUSTERS,
              blendedScore: 1 - i * 0.05,
            })),
          },
        } as MessageEvent);
      }, 0);
    }
  }

  terminate() {
    mockTerminate();
  }
}

// @ts-expect-error - mock for test environment
globalThis.Worker = MockWorker;

// ── Helpers ──
function makeVector(values: number[]): AmenityVector {
  const vec = {} as AmenityVector;
  KMEANS_DIMENSIONS.forEach((dim, i) => {
    vec[dim] = values[i] ?? 0.5;
  });
  return vec;
}

function makePreference(id: string, values: number[]): PreferenceVector {
  return { id, vector: makeVector(values) };
}

function makeVenue(id: string, score: number) {
  return { id, score };
}

// ── Mock localStorage ──
let localStorageStore: Record<string, string> = {};

beforeEach(() => {
  localStorageStore = {};
  Storage.prototype.getItem = jest.fn(
    (key: string) => localStorageStore[key] ?? null,
  );
  Storage.prototype.setItem = jest.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  });
  jest.clearAllMocks();
});

// ── Import AFTER mocking ──
import { usePreferenceReranking } from "@/hooks/usePreferenceReranking";

describe("usePreferenceReranking (#1270)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("initialization", () => {
    it("starts with isReady=false and no centroids", () => {
      const { result } = renderHook(() =>
        usePreferenceReranking([]),
      );
      expect(result.current.isReady).toBe(false);
      expect(result.current.centroids).toBeNull();
      expect(result.current.rankedResults).toEqual([]);
    });
  });

  describe("5-cluster centroid computation", () => {
    it("computes exactly 5 centroids from preference vectors", async () => {
      const prefs = Array.from({ length: 10 }, (_, i) =>
        makePreference(`p${i}`, KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );

      const { result } = renderHook(() =>
        usePreferenceReranking(prefs),
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(result.current.centroids).not.toBeNull();
      expect(result.current.centroids!.centroids).toHaveLength(NUM_CLUSTERS);
      expect(result.current.centroids!.k).toBe(NUM_CLUSTERS);
    });

    it("handles empty preferences gracefully", async () => {
      const { result } = renderHook(() =>
        usePreferenceReranking([]),
      );

      // Trigger compute manually
      await act(async () => {
        await result.current.recompute();
      });

      expect(result.current.centroids).not.toBeNull();
      expect(result.current.centroids!.centroids).toHaveLength(NUM_CLUSTERS);
    });
  });

  describe("Euclidean distance ranking", () => {
    it("returns ranked venues with distance and cluster info", async () => {
      const prefs = Array.from({ length: 10 }, (_, i) =>
        makePreference(`p${i}`, KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );

      const { result } = renderHook(() =>
        usePreferenceReranking(prefs),
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const venues = [
        makeVenue("v1", 5),
        makeVenue("v2", 8),
        makeVenue("v3", 3),
      ];

      let ranked: ReturnType<typeof result.current.rankVenues> extends Promise<infer R> ? R : never;
      await act(async () => {
        ranked = await result.current.rankVenues(venues);
      });

      expect(ranked!).toHaveLength(3);
      for (const r of ranked!) {
        expect(typeof r.serverScore).toBe("number");
        expect(typeof r.clientScore).toBe("number");
        expect(typeof r.blendedScore).toBe("number");
        expect(typeof r.nearestCluster).toBe("number");
        expect(typeof r.distanceToCentroid).toBe("number");
        expect(r.nearestCluster).toBeGreaterThanOrEqual(0);
        expect(r.nearestCluster).toBeLessThan(NUM_CLUSTERS);
      }
    });

    it("results are sorted by blended score descending", async () => {
      const prefs = Array.from({ length: 10 }, (_, i) =>
        makePreference(`p${i}`, KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );

      const { result } = renderHook(() =>
        usePreferenceReranking(prefs),
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const venues = Array.from({ length: 5 }, (_, i) =>
        makeVenue(`v${i}`, i + 1),
      );

      let ranked: Array<{ blendedScore: number }> = [];
      await act(async () => {
        ranked = await result.current.rankVenues(venues);
      });

      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i].blendedScore).toBeLessThanOrEqual(
          ranked[i - 1].blendedScore,
        );
      }
    });
  });

  describe("client-side only re-ranking", () => {
    it("re-ranks entirely client-side without server round-trips", async () => {
      const prefs = Array.from({ length: 10 }, (_, i) =>
        makePreference(`p${i}`, KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );

      const { result } = renderHook(() =>
        usePreferenceReranking(prefs),
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Rank venues — this must complete without any network calls
      const venues = [
        makeVenue("v1", 5),
        makeVenue("v2", 8),
        makeVenue("v3", 3),
      ];

      let ranked: Array<{ id: string; blendedScore: number; nearestCluster: number }> = [];
      await act(async () => {
        ranked = await result.current.rankVenues(venues);
      });

      expect(ranked).toHaveLength(3);
      // All venues must be present with valid cluster assignments
      for (const r of ranked) {
        expect(r.nearestCluster).toBeGreaterThanOrEqual(0);
        expect(r.nearestCluster).toBeLessThan(NUM_CLUSTERS);
      }
      // Results are sorted by blended score descending
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i].blendedScore).toBeLessThanOrEqual(
          ranked[i - 1].blendedScore,
        );
      }
    });

    it("re-ranks without centroids by falling back to server score", async () => {
      const { result } = renderHook(() =>
        usePreferenceReranking([]),
      );

      const venues = [makeVenue("v1", 3), makeVenue("v2", 9)];

      let ranked: Array<{ id: string; blendedScore: number }> = [];
      await act(async () => {
        ranked = await result.current.rankVenues(venues);
      });

      // Should be sorted by server score when no centroids
      expect(ranked[0].id).toBe("v2");
      expect(ranked[1].id).toBe("v1");
    });
  });

  describe("custom blend weights", () => {
    it("respects custom server and client weights", async () => {
      const prefs = Array.from({ length: 10 }, (_, i) =>
        makePreference(`p${i}`, KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );

      const { result } = renderHook(() =>
        usePreferenceReranking(prefs, {
          serverWeight: 1.0,
          clientWeight: 0.0,
        }),
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const venues = [makeVenue("v1", 2), makeVenue("v2", 9)];

      let ranked: Array<{ id: string; serverScore: number }> = [];
      await act(async () => {
        ranked = await result.current.rankVenues(venues);
      });

      // With server-only weight, venue with higher server score should rank first
      expect(ranked[0].id).toBe("v2");
    });
  });

  describe("localStorage persistence", () => {
    it("saves centroids to localStorage after computation", async () => {
      const prefs = Array.from({ length: 10 }, (_, i) =>
        makePreference(`p${i}`, KMEANS_DIMENSIONS.map(() => (i % 10) / 10)),
      );

      const { result } = renderHook(() =>
        usePreferenceReranking(prefs),
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(localStorage.setItem).toHaveBeenCalledWith(
        "worksphere:preference-centroids",
        expect.any(String),
      );
    });
  });

  describe("setPreferences", () => {
    it("allows updating preferences externally", async () => {
      const initialPrefs = Array.from({ length: 5 }, (_, i) =>
        makePreference(`p${i}`, KMEANS_DIMENSIONS.map(() => 0.1)),
      );

      const { result } = renderHook(() =>
        usePreferenceReranking(initialPrefs),
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const newPrefs = Array.from({ length: 5 }, (_, i) =>
        makePreference(`p${i}`, KMEANS_DIMENSIONS.map(() => 0.9)),
      );

      await act(async () => {
        result.current.setPreferences(newPrefs);
      });

      // Trigger recompute with new preferences
      await act(async () => {
        await result.current.recompute();
      });

      expect(result.current.centroids).not.toBeNull();
    });
  });

  describe("terminate", () => {
    it("can be called safely", async () => {
      const { result } = renderHook(() =>
        usePreferenceReranking([]),
      );

      expect(() => result.current.terminate()).not.toThrow();
    });
  });
});
