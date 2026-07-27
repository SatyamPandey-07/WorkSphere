import { renderHook, act, waitFor } from "@testing-library/react";
import { KMEANS_DIMENSIONS, NUM_CLUSTERS } from "@/lib/kmeans/types";
import type { AmenityVector } from "@/lib/kmeans/types";

// Mock Worker for Jest CJS environment
const mockPostMessage = jest.fn();
const mockTerminate = jest.fn();

class MockWorker {
  url: string | URL;
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(url: string | URL) {
    this.url = url;
  }

  postMessage(msg: unknown) {
    mockPostMessage(msg);
    // Simulate INIT_SUCCESS
    if ((msg as { type: string }).type === "INIT" && this.onmessage) {
      setTimeout(() => {
        this.onmessage!(
          new MessageEvent("message", {
            data: { type: "INIT_SUCCESS", id: (msg as { id: string }).id },
          }),
        );
      }, 0);
    }
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

// Must import AFTER mocking
import { useKMeansClustering } from "@/hooks/useKMeansClustering";

function makeSavedVenueLike(overrides: Partial<AmenityVector> = {}) {
  return {
    id: "v1",
    venueId: "v1",
    venue: {
      id: "v1",
      rating: 4,
      wifiQuality: 8,
      hasOutlets: true,
      noiseLevel: "quiet" as string | null,
      ...Object.fromEntries(
        KMEANS_DIMENSIONS.filter(
          (d) =>
            !["rating", "wifiQuality", "hasOutlets", "noiseLevel"].includes(d),
        ).map((d) => [d, overrides[d] ?? 0.5]),
      ),
    },
  };
}

describe("useKMeansClustering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("initializes with no centroids", () => {
    const { result } = renderHook(() => useKMeansClustering([]));

    expect(result.current.isReady).toBe(false);
    expect(result.current.centroids).toBeNull();
    expect(result.current.isRecomputing).toBe(false);
  });

  it("computes clusters from favorites", async () => {
    const favorites = Array.from({ length: 10 }, (_, i) =>
      makeSavedVenueLike({
        wifiQuality: i / 10,
        hasOutlets: i % 2 === 0 ? 1 : 0,
      }),
    );

    const { result } = renderHook(() => useKMeansClustering(favorites));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.centroids).not.toBeNull();
    expect(result.current.centroids!.centroids).toHaveLength(NUM_CLUSTERS);
    expect(result.current.centroids!.k).toBe(NUM_CLUSTERS);

    for (const centroid of result.current.centroids!.centroids) {
      for (const dim of KMEANS_DIMENSIONS) {
        expect(centroid[dim]).not.toBeNaN();
        expect(centroid[dim]).toBeGreaterThanOrEqual(0);
        expect(centroid[dim]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns empty array for empty venues", async () => {
    const favorites = Array.from({ length: 10 }, () => makeSavedVenueLike());

    const { result } = renderHook(() => useKMeansClustering(favorites));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    const ranked = await result.current.rankVenues([]);
    expect(ranked).toEqual([]);
  });

  it("rankVenues returns cluster scores", async () => {
    const favorites = Array.from({ length: 10 }, (_, i) =>
      makeSavedVenueLike({ wifiQuality: i / 10 }),
    );

    const { result } = renderHook(() => useKMeansClustering(favorites));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    const venues = [
      { id: "v1", score: 5 },
      { id: "v2", score: 8 },
    ];

    const ranked = await result.current.rankVenues(venues);
    expect(ranked).toHaveLength(2);

    for (const r of ranked) {
      expect(typeof r.clusterScore).toBe("number");
      expect(typeof r.cluster).toBe("number");
      expect(r.cluster).toBeGreaterThanOrEqual(0);
      expect(r.cluster).toBeLessThan(NUM_CLUSTERS);
    }
  });

  it("recomputes when favorites change", async () => {
    const favorites1 = Array.from({ length: 5 }, (_, i) =>
      makeSavedVenueLike({ wifiQuality: i / 5 }),
    );
    const favorites2 = Array.from({ length: 5 }, (_, i) =>
      makeSavedVenueLike({ wifiQuality: 1 - i / 5 }),
    );

    const { result, rerender } = renderHook(
      ({ favs }) => useKMeansClustering(favs),
      { initialProps: { favs: favorites1 } },
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    const centroids1 = result.current.centroids;

    rerender({ favs: favorites2 });

    await waitFor(() => {
      expect(result.current.centroids).not.toEqual(centroids1);
    });
  });

  it("terminate cleans up worker", async () => {
    const favorites = [makeSavedVenueLike()];

    const { result } = renderHook(() => useKMeansClustering(favorites));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    act(() => {
      result.current.terminate();
    });

    expect(result.current.isReady).toBe(false);
  });

  it("handles duplicate vectors via deduplication", async () => {
    const favorites = Array.from({ length: 10 }, () =>
      makeSavedVenueLike({ wifiQuality: 0.8, hasOutlets: 1 }),
    );

    const { result } = renderHook(() => useKMeansClustering(favorites));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.centroids!.dataPoints).toBe(1);
  });
});
