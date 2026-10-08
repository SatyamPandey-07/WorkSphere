import {
  clusterMarkers,
  latLngToPixel,
  createClusterIcon,
  ViewportWatcher,
  type MapViewportBounds,
} from "@/components/Map";
import { render, act } from "@testing-library/react";
import type { MapMarker } from "@/types/map";

// Mock react-leaflet useMap hook
const mockMapEvents: Record<string, () => void> = {};
const mockMapInstance = {
  getBounds: jest.fn(() => ({
    getSouth: () => 37.70,
    getNorth: () => 37.82,
    getWest: () => -122.52,
    getEast: () => -122.35,
  })),
  getZoom: jest.fn(() => 13),
  on: jest.fn((event: string, handler: () => void) => {
    mockMapEvents[event] = handler;
  }),
  off: jest.fn((event: string) => {
    delete mockMapEvents[event];
  }),
};

jest.mock("react-leaflet", () => ({
  useMap: () => mockMapInstance,
}));

describe("MapBoundingBox & Marker Clustering (#3473)", () => {
  const sampleMarkers: MapMarker[] = [
    {
      id: "venue-1",
      name: "Cafe Alpha",
      position: { lat: 37.7749, lng: -122.4194 },
      category: "cafe",
    },
    {
      id: "venue-2",
      name: "Cafe Beta",
      // Very close to venue-1: should cluster
      position: { lat: 37.7751, lng: -122.4196 },
      category: "cafe",
    },
    {
      id: "venue-3",
      name: "Cafe Gamma",
      // Far away in Oakland: should remain unclustered
      position: { lat: 37.8044, lng: -122.2712 },
      category: "coworking",
    },
  ];

  describe("latLngToPixel Web Mercator projection", () => {
    it("converts latitude and longitude to pixel coordinates at zoom level", () => {
      const p1 = latLngToPixel(37.7749, -122.4194, 13);
      const p2 = latLngToPixel(37.7749, -122.4194, 14);

      expect(typeof p1.x).toBe("number");
      expect(typeof p1.y).toBe("number");
      // Doubling zoom approximately doubles pixel coordinate space
      expect(p2.x).toBeCloseTo(p1.x * 2, 0);
      expect(p2.y).toBeCloseTo(p1.y * 2, 0);
    });
  });

  describe("clusterMarkers", () => {
    it("groups high-density neighboring pins into circular clusters with accurate count", () => {
      const { clusters, unclustered } = clusterMarkers(sampleMarkers, 13, 60);

      // venue-1 and venue-2 should be grouped into a single cluster
      expect(clusters).toHaveLength(1);
      expect(clusters[0].count).toBe(2);
      expect(clusters[0].markers.map((m) => m.id)).toEqual(
        expect.arrayContaining(["venue-1", "venue-2"])
      );

      // venue-3 should remain unclustered
      expect(unclustered).toHaveLength(1);
      expect(unclustered[0].id).toBe("venue-3");
    });

    it("does not cluster when zoom is zoomed in (zoom >= 17) to allow individual inspection", () => {
      const { clusters, unclustered } = clusterMarkers(sampleMarkers, 17, 60);

      expect(clusters).toHaveLength(0);
      expect(unclustered).toHaveLength(sampleMarkers.length);
    });

    it("filters out markers with null or invalid coordinates gracefully", () => {
      const corruptedMarkers: any[] = [
        ...sampleMarkers,
        { id: "corrupt-1", name: "Corrupt", position: null },
        { id: "corrupt-2", name: "NaN", position: { lat: NaN, lng: -122.4 } },
      ];

      const { clusters, unclustered } = clusterMarkers(corruptedMarkers, 13, 60);
      const totalCount =
        clusters.reduce((sum, c) => sum + c.count, 0) + unclustered.length;
      expect(totalCount).toBe(sampleMarkers.length);
    });
  });

  describe("createClusterIcon", () => {
    it("generates a Leaflet DivIcon containing badge with venue count", () => {
      const icon = createClusterIcon(5);
      expect(icon).toBeDefined();
      expect(icon.options.className).toContain("custom-marker-cluster");
      expect(icon.options.html).toContain("data-testid=\"marker-cluster-5\"");
      expect(icon.options.html).toContain("<span>5</span>");
    });
  });

  describe("ViewportWatcher debounced viewport refetching", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("attaches debounced moveend and zoomend listeners and notifies viewport bounds", () => {
      const onViewportChange = jest.fn();

      render(
        <ViewportWatcher
          onViewportChange={onViewportChange}
          debounceMs={300}
        />
      );

      // Initial invocation is debounced
      expect(onViewportChange).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(onViewportChange).toHaveBeenCalledTimes(1);
      expect(onViewportChange).toHaveBeenCalledWith<[MapViewportBounds]>({
        minLat: 37.70,
        maxLat: 37.82,
        minLng: -122.52,
        maxLng: -122.35,
        zoom: 13,
      });

      // Trigger moveend event
      act(() => {
        if (mockMapEvents["moveend"]) {
          mockMapEvents["moveend"]();
        }
      });

      expect(onViewportChange).toHaveBeenCalledTimes(1);

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(onViewportChange).toHaveBeenCalledTimes(2);

      // Trigger zoomend event
      act(() => {
        if (mockMapEvents["zoomend"]) {
          mockMapEvents["zoomend"]();
        }
      });

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(onViewportChange).toHaveBeenCalledTimes(3);
    });
  });
});
