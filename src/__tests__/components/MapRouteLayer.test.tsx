import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MapRouteLayer,
  decodePolyline,
  encodePolyline,
  routesToGeoJson,
  rebindRouteGeoJson,
  rebindVectorTileLayers,
  recreateRouteBuffers,
} from "@/components/map/MapRouteLayer";

// Mock react-leaflet
jest.mock("react-leaflet", () => ({
  Polyline: ({ children, positions, pathOptions }: any) => (
    <div
      data-testid="polyline"
      data-positions={JSON.stringify(positions)}
      data-color={pathOptions?.color}
    >
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="popup">{children}</div>,
  useMap: () => null,
}));

describe("MapRouteLayer Component & WebGL Context Recovery", () => {
  let canvas: HTMLCanvasElement;
  let mockMap: any;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    canvas.getContext = jest.fn((type: string) => {
      if (type === "webgl" || type === "webgl2") {
        return {
          createBuffer: jest.fn().mockReturnValue({}),
          bindBuffer: jest.fn(),
          bufferData: jest.fn(),
          viewport: jest.fn(),
          ARRAY_BUFFER: 0x8892,
          STATIC_DRAW: 0x88e4,
        };
      }
      return null;
    }) as any;

    mockMap = {
      getContainer: jest.fn(() => ({
        querySelector: jest.fn(() => canvas),
      })),
      invalidateSize: jest.fn(),
      style: {
        sourceCaches: {
          "vector-tiles": {
            reload: jest.fn(),
            clearTiles: jest.fn(),
          },
        },
      },
      getSource: jest.fn((id: string) => {
        if (id === "route-source" || id === "routes") {
          return { setData: jest.fn() };
        }
        return null;
      }),
      eachLayer: jest.fn((cb: (layer: any) => void) => {
        cb({ redraw: jest.fn() });
      }),
      triggerRepaint: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Polyline Utilities & GeoJSON Mapping", () => {
    it("encodes and decodes polyline coordinates correctly", () => {
      const coords: [number, number][] = [
        [38.5, -120.2],
        [40.7, -120.95],
        [43.252, -126.453],
      ];
      const encoded = encodePolyline(coords);
      expect(typeof encoded).toBe("string");
      expect(encoded.length).toBeGreaterThan(0);

      const decoded = decodePolyline(encoded);
      expect(decoded.length).toBe(coords.length);
      expect(decoded[0][0]).toBeCloseTo(38.5, 4);
      expect(decoded[0][1]).toBeCloseTo(-120.2, 4);
    });

    it("converts routes and optimizedRoute to standard GeoJSON FeatureCollection", () => {
      const routes = [
        {
          id: "route-1",
          name: "Commute",
          path: [
            { lat: 40.71, lng: -74.0 },
            { lat: 40.72, lng: -74.01 },
          ],
          distance: 1500,
          duration: 300,
        },
      ];
      const optimizedRoute = {
        coordinates: [
          [40.71, -74.0],
          [40.75, -73.98],
        ] as [number, number][],
        distance: 5000,
        duration: 900,
      };

      const geoJson = routesToGeoJson(routes, optimizedRoute);
      expect(geoJson.type).toBe("FeatureCollection");
      expect(geoJson.features.length).toBe(2);

      const optFeature = geoJson.features.find(
        (f: any) => f.id === "optimized-route",
      );
      expect(optFeature).toBeDefined();
      expect(optFeature.geometry.type).toBe("LineString");
      // GeoJSON coordinate order: [lng, lat]
      expect(optFeature.geometry.coordinates[0]).toEqual([-74.0, 40.71]);
    });
  });

  describe("Acceptance Criteria 1: Prevent Default on webglcontextlost", () => {
    it("calls preventDefault() on webglcontextlost to allow browser recovery", () => {
      const onContextLost = jest.fn();
      render(
        <MapRouteLayer
          canvas={canvas}
          map={mockMap}
          onContextLost={onContextLost}
        />,
      );

      const lostEvent = new Event("webglcontextlost", {
        cancelable: true,
        bubbles: true,
      });
      const preventDefaultSpy = jest.spyOn(lostEvent, "preventDefault");

      act(() => {
        canvas.dispatchEvent(lostEvent);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(onContextLost).toHaveBeenCalledTimes(1);

      // Verifies context lost overlay appears
      expect(screen.getByTestId("map-route-context-lost")).toBeInTheDocument();
      expect(
        screen.getByText("Recovering WebGL graphics context..."),
      ).toBeInTheDocument();

      const layer = screen.getByTestId("map-route-layer");
      expect(layer).toHaveAttribute("data-context-lost", "true");
    });
  });

  describe("Acceptance Criteria 2: Re-bind vector tiles and route GeoJSON on webglcontextrestored", () => {
    it("re-binds vector tile layers and route GeoJSON datasets upon restoration", () => {
      const onContextRestored = jest.fn();
      const mockSource = { setData: jest.fn() };
      mockMap.getSource = jest.fn(() => mockSource);

      const routes = [
        {
          id: "r1",
          name: "Main Route",
          path: [
            { lat: 40.7, lng: -74.0 },
            { lat: 40.75, lng: -73.9 },
          ],
          distance: 1200,
        },
      ];

      render(
        <MapRouteLayer
          canvas={canvas}
          map={mockMap}
          routes={routes}
          vectorTileLayers={["vector-tiles"]}
          onContextRestored={onContextRestored}
        />,
      );

      // Trigger context lost first
      const lostEvent = new Event("webglcontextlost", { cancelable: true });
      act(() => {
        canvas.dispatchEvent(lostEvent);
      });

      expect(screen.getByTestId("map-route-context-lost")).toBeInTheDocument();

      // Trigger context restored
      const restoredEvent = new Event("webglcontextrestored", {
        cancelable: true,
      });
      act(() => {
        canvas.dispatchEvent(restoredEvent);
      });

      expect(onContextRestored).toHaveBeenCalledTimes(1);

      // Verify vector tile layers were reloaded
      expect(
        mockMap.style.sourceCaches["vector-tiles"].reload,
      ).toHaveBeenCalled();

      // Verify route GeoJSON dataset was re-bound
      expect(mockSource.setData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "FeatureCollection",
        }),
      );

      // Verify map layout size was invalidated for re-render
      expect(mockMap.invalidateSize).toHaveBeenCalled();

      // Verify context lost overlay is gone and polylines are re-rendered
      expect(
        screen.queryByTestId("map-route-context-lost"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("map-route-layer")).toHaveAttribute(
        "data-context-lost",
        "false",
      );
      expect(screen.getByTestId("polyline")).toBeInTheDocument();
    });

    it("recreates WebGL route buffers cleanly via recreateRouteBuffers", () => {
      const mockGl = {
        createBuffer: jest.fn().mockReturnValue({}),
        bindBuffer: jest.fn(),
        bufferData: jest.fn(),
        viewport: jest.fn(),
        ARRAY_BUFFER: 0x8892,
        STATIC_DRAW: 0x88e4,
      } as unknown as WebGLRenderingContext;

      const routes = [
        {
          id: "r1",
          path: [
            { lat: 40.71, lng: -74.0 },
            { lat: 40.72, lng: -74.01 },
          ],
        },
      ];
      const optRoute = {
        coordinates: [
          [40.71, -74.0],
          [40.73, -73.99],
        ] as [number, number][],
        distance: 2000,
        duration: 400,
      };

      const buffers = recreateRouteBuffers(mockGl, routes, optRoute, canvas);
      expect(mockGl.createBuffer).toHaveBeenCalled();
      expect(mockGl.bindBuffer).toHaveBeenCalled();
      expect(mockGl.bufferData).toHaveBeenCalled();
      expect(buffers.positionBuffer).toBeDefined();
    });

    it("rebindVectorTileLayers and rebindRouteGeoJson handle missing sources gracefully", () => {
      expect(rebindVectorTileLayers(null)).toBe(false);
      expect(rebindRouteGeoJson(null, {})).toBe(false);

      const emptyMap = {};
      expect(rebindVectorTileLayers(emptyMap)).toBe(false);
      expect(rebindRouteGeoJson(emptyMap, {})).toBe(false);
    });
  });

  describe("Acceptance Criteria 3: Background/Foreground Tab Switching Cycle on Mobile Viewports", () => {
    it("handles tab backgrounding and restores route layers when foregrounded", () => {
      const onVisibilityChange = jest.fn();
      const mockSource = { setData: jest.fn() };
      mockMap.getSource = jest.fn(() => mockSource);

      const routes = [
        {
          id: "route-mobile",
          name: "Mobile Navigation",
          path: [
            { lat: 37.77, lng: -122.41 },
            { lat: 37.78, lng: -122.42 },
          ],
        },
      ];

      render(
        <MapRouteLayer
          canvas={canvas}
          map={mockMap}
          routes={routes}
          onVisibilityChange={onVisibilityChange}
        />,
      );

      // Simulate tab switching to background (e.g. mobile browser home or other tab)
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(onVisibilityChange).toHaveBeenCalledWith(false);

      // Simulate WebGL context lost while backgrounded on mobile
      const lostEvent = new Event("webglcontextlost", { cancelable: true });
      act(() => {
        canvas.dispatchEvent(lostEvent);
      });
      expect(screen.getByTestId("map-route-layer")).toHaveAttribute(
        "data-context-lost",
        "true",
      );

      // User returns to tab on mobile: visibilityState becomes "visible"
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(onVisibilityChange).toHaveBeenCalledWith(true);
      expect(mockMap.invalidateSize).toHaveBeenCalled();
      expect(mockSource.setData).toHaveBeenCalled();

      // Trigger WebGL context restoration upon returning
      act(() => {
        canvas.dispatchEvent(new Event("webglcontextrestored"));
      });

      // Verify layer is restored without manual page reload
      expect(screen.getByTestId("map-route-layer")).toHaveAttribute(
        "data-context-lost",
        "false",
      );
      expect(screen.getByTestId("polyline")).toBeInTheDocument();
    });
  });
});
