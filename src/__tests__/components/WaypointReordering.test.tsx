import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock Clerk
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: "test-user",
      hasImage: true,
      imageUrl: "https://example.com/avatar.jpg",
    },
  }),
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue(null),
  }),
}));

// Mock PartySocket
jest.mock("partysocket/react", () => {
  return jest.fn(() => ({
    send: jest.fn(),
    readyState: 1,
  }));
});

// Mock useSeatAvailability
jest.mock("@/hooks/useSeatAvailability", () => ({
  useSeatAvailability: () => ({
    availability: {},
    getAvailability: (venueId: string) => ({
      venueId,
      count: 0,
      capacity: 8,
      status: "green",
    }),
    checkIn: jest.fn(),
    checkOut: jest.fn(),
    checkedInVenueId: null,
    isConnected: true,
  }),
}));

// Mock react-leaflet
jest.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children, position }: any) => (
    <div data-testid="marker" data-position={JSON.stringify(position)}>
      {children}
    </div>
  ),
  Polyline: ({ positions, pathOptions }: any) => (
    <div
      data-testid="polyline"
      data-positions={JSON.stringify(positions)}
      data-color={pathOptions?.color}
    />
  ),
  Popup: ({ children }: any) => <div data-testid="popup">{children}</div>,
  useMap: () => ({
    setView: jest.fn(),
    flyTo: jest.fn(),
    flyToBounds: jest.fn(),
    getContainer: () => document.createElement("div"),
    invalidateSize: jest.fn(),
    getZoom: () => 13,
    getCenter: () => ({ lat: 40.7128, lng: -74.006 }),
    on: jest.fn(),
    off: jest.fn(),
  }),
  useMapEvents: () => null,
  LayersControl: Object.assign(
    ({ children }: any) => <div data-testid="layers-control">{children}</div>,
    {
      BaseLayer: ({ children }: any) => <div data-testid="base-layer">{children}</div>,
      Overlay: ({ children }: any) => <div data-testid="overlay">{children}</div>,
    },
  ),
  LayerGroup: ({ children }: any) => <div>{children}</div>,
  CircleMarker: () => <div data-testid="circle-marker" />,
  ScaleControl: () => <div data-testid="scale-control" />,
}));

// Mock Leaflet
jest.mock("leaflet", () => ({
  divIcon: jest.fn(() => ({})),
  icon: jest.fn(() => ({})),
  latLngBounds: jest.fn(() => ({
    isValid: () => true,
    pad: jest.fn().mockReturnThis(),
    extend: jest.fn(),
  })),
  heatLayer: jest.fn(() => ({ addTo: jest.fn() })),
  Icon: {
    Default: {
      prototype: {},
      mergeOptions: jest.fn(),
    },
  },
}));

import {
  RoutingOptimizer,
  type RoutingVenueItem,
  type OptimizedRouteData,
} from "@/components/map/RoutingOptimizer";
import Map from "@/components/Map";

describe("Waypoint Reordering & Route Recalculation Integration", () => {
  const sampleVenues: RoutingVenueItem[] = [
    { id: "venue-1", name: "Artisan Coffee", latitude: 40.7128, longitude: -74.006 },
    { id: "venue-2", name: "WeWork Space", latitude: 40.7200, longitude: -74.010 },
    { id: "venue-3", name: "Quiet Library", latitude: 40.7300, longitude: -74.002 },
  ];

  const sampleRoute: OptimizedRouteData = {
    distance: 2400, // 2.4 km
    duration: 1800, // 30 mins
    coordinates: [
      [40.7128, -74.006],
      [40.7200, -74.010],
      [40.7300, -74.002],
    ],
  };

  const defaultLocation = { latitude: 40.7128, longitude: -74.006 };

  describe("RoutingOptimizer Component Unit Tests", () => {
    it("1. renders selected destinations in their original sequence and displays badges", () => {
      render(
        <RoutingOptimizer
          routingQueue={sampleVenues}
          optimizedRoute={sampleRoute}
        />,
      );

      expect(screen.getByText("Artisan Coffee")).toBeInTheDocument();
      expect(screen.getByText("WeWork Space")).toBeInTheDocument();
      expect(screen.getByText("Quiet Library")).toBeInTheDocument();

      expect(screen.getByTestId("stop-index-0")).toHaveTextContent("1");
      expect(screen.getByTestId("stop-index-1")).toHaveTextContent("2");
      expect(screen.getByTestId("stop-index-2")).toHaveTextContent("3");
    });

    it("2. supports keyboard reordering using Move Down and Move Up buttons", () => {
      const handleReorder = jest.fn();
      render(
        <RoutingOptimizer
          routingQueue={sampleVenues}
          onReorderWaypoints={handleReorder}
        />,
      );

      const moveDownBtn = screen.getByRole("button", { name: /Move Artisan Coffee down/i });
      fireEvent.click(moveDownBtn);

      expect(handleReorder).toHaveBeenCalledTimes(1);
      const newOrder = handleReorder.mock.calls[0][0];
      expect(newOrder[0].id).toBe("venue-2");
      expect(newOrder[1].id).toBe("venue-1");
      expect(newOrder[2].id).toBe("venue-3");
    });

    it("3. preserves destination identity and metadata during reordering without mutating state", () => {
      const handleReorder = jest.fn();
      const initialCopy = [...sampleVenues];

      render(
        <RoutingOptimizer
          routingQueue={sampleVenues}
          onReorderWaypoints={handleReorder}
        />,
      );

      const moveUpBtn = screen.getByRole("button", { name: /Move Quiet Library up/i });
      fireEvent.click(moveUpBtn);

      expect(handleReorder).toHaveBeenCalledTimes(1);
      const reordered = handleReorder.mock.calls[0][0];
      expect(reordered[1].id).toBe("venue-3");
      expect(reordered[1].name).toBe("Quiet Library");
      expect(reordered[1].latitude).toBe(40.7300);
      expect(reordered[1].longitude).toBe(-74.002);

      // Verify original array was not mutated in place
      expect(sampleVenues[0].id).toBe(initialCopy[0].id);
      expect(sampleVenues[2].id).toBe(initialCopy[2].id);
    });

    it("4. displays route metrics (distance, duration, stops) accurately", () => {
      render(
        <RoutingOptimizer
          routingQueue={sampleVenues}
          optimizedRoute={sampleRoute}
          travelProfile="walking"
        />,
      );

      expect(screen.getByTestId("metric-stops")).toHaveTextContent("3 stops");
      expect(screen.getByTestId("metric-distance")).toHaveTextContent("2.40 km");
      expect(screen.getByTestId("metric-duration")).toHaveTextContent("30 mins");
    });

    it("5. displays loading state when recalculating route", () => {
      render(
        <RoutingOptimizer
          routingQueue={sampleVenues}
          isLoading={true}
        />,
      );

      expect(screen.getByTestId("route-summary-loading")).toBeInTheDocument();
      expect(screen.getByText(/Recalculating route metrics.../i)).toBeInTheDocument();
    });

    it("6. displays routing error message gracefully when calculation fails", () => {
      render(
        <RoutingOptimizer
          routingQueue={sampleVenues}
          routingError="Network timeout connecting to OSRM"
        />,
      );

      expect(screen.getByTestId("route-summary-error")).toBeInTheDocument();
      expect(screen.getByText("Network timeout connecting to OSRM")).toBeInTheDocument();
    });

    it("7. allows removing a destination via the remove button", () => {
      const handleRemove = jest.fn();
      render(
        <RoutingOptimizer
          routingQueue={sampleVenues}
          onRemoveVenue={handleRemove}
        />,
      );

      const removeBtn = screen.getByRole("button", { name: /Remove WeWork Space from route/i });
      fireEvent.click(removeBtn);

      expect(handleRemove).toHaveBeenCalledTimes(1);
      expect(handleRemove).toHaveBeenCalledWith(1);
    });

    it("8. renders empty state placeholder when routingQueue is empty", () => {
      render(<RoutingOptimizer routingQueue={[]} />);
      expect(
        screen.getByText(/Click markers or venue listings to chain multiple destinations/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("route-summary-card")).not.toBeInTheDocument();
    });
  });

  describe("Map & Routing Integration Tests", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      jest.restoreAllMocks();
    });

    it("9. triggers OSRM route recalculation when waypoints are reordered in Map", async () => {
      const mockOsrmResponse = {
        code: "Ok",
        routes: [
          {
            geometry: {
              coordinates: [
                [-74.010, 40.7200],
                [-74.006, 40.7128],
                [-74.002, 40.7300],
              ],
            },
            distance: 3100,
            duration: 2100,
            legs: [],
          },
        ],
      };

      const fetchMock = jest.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("router.project-osrm.org")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockOsrmResponse,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [] }),
        });
      });
      global.fetch = fetchMock;

      render(
        <Map
          location={defaultLocation}
          initialRoutingQueue={[sampleVenues[0], sampleVenues[1]]}
        />,
      );

      // Trigger move down on stop 1 (Artisan Coffee)
      const moveDownBtn = screen.getByRole("button", { name: /Move Artisan Coffee down/i });
      await act(async () => {
        fireEvent.click(moveDownBtn);
      });

      await waitFor(() => {
        const osrmCalls = fetchMock.mock.calls.filter((c: any[]) =>
          typeof c[0] === "string" && c[0].includes("router.project-osrm.org"),
        );
        expect(osrmCalls.length).toBe(1);
      });

      // Inspect that the fetch URL contains the new coordinate order:
      // venue-2 (-74.01, 40.72) followed by venue-1 (-74.006, 40.7128)
      const osrmCalls = fetchMock.mock.calls.filter((c: any[]) =>
        typeof c[0] === "string" && c[0].includes("router.project-osrm.org"),
      );
      const fetchUrl = osrmCalls[0][0];
      expect(fetchUrl).toContain("-74.01,40.72;-74.006,40.7128");
    });

    it("10. updates polyline coordinates to reflect the reordered route", async () => {
      const mockOsrmResponse = {
        code: "Ok",
        routes: [
          {
            geometry: {
              coordinates: [
                [-74.010, 40.7200],
                [-74.006, 40.7128],
              ],
            },
            distance: 1500,
            duration: 1200,
            legs: [],
          },
        ],
      };

      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("router.project-osrm.org")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockOsrmResponse,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [] }),
        });
      });

      render(
        <Map
          location={defaultLocation}
          initialRoutingQueue={[sampleVenues[0], sampleVenues[1]]}
        />,
      );

      const moveDownBtn = screen.getByRole("button", { name: /Move Artisan Coffee down/i });
      await act(async () => {
        fireEvent.click(moveDownBtn);
      });

      await waitFor(() => {
        const polylines = screen.getAllByTestId("polyline");
        expect(polylines.length).toBeGreaterThan(0);
        const positionsAttr = polylines[0].getAttribute("data-positions");
        expect(positionsAttr).toContain("40.72");
      });
    });

    it("11. guards against stale overlapping asynchronous route responses", async () => {
      let resolveFirstRequest: any;
      const firstPromise = new Promise((resolve) => {
        resolveFirstRequest = resolve;
      });

      const secondResponse = {
        code: "Ok",
        routes: [
          {
            geometry: {
              coordinates: [
                [-74.002, 40.7300],
                [-74.010, 40.7200],
              ],
            },
            distance: 4000,
            duration: 3000,
            legs: [],
          },
        ],
      };

      let osrmCount = 0;
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("router.project-osrm.org")) {
          osrmCount++;
          if (osrmCount === 1) {
            // First reorder request hangs
            return firstPromise;
          }
          // Second reorder request completes fast
          return Promise.resolve({
            ok: true,
            json: async () => secondResponse,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [] }),
        });
      });

      render(
        <Map
          location={defaultLocation}
          initialRoutingQueue={[sampleVenues[0], sampleVenues[1], sampleVenues[2]]}
        />,
      );

      // Trigger first reorder (move stop 1 down) -> hangs on firstPromise
      const mapMoveDownBtn = screen.getByRole("button", { name: /Move Artisan Coffee down/i });
      act(() => {
        fireEvent.click(mapMoveDownBtn);
      });

      // Now venue list is [sampleVenues[1] (WeWork Space), sampleVenues[0] (Artisan Coffee), sampleVenues[2] (Quiet Library)]
      // Trigger second reorder by clicking remove on the last stop -> completes fast with secondResponse
      const removeBtn = screen.getByRole("button", { name: /Remove Quiet Library from route/i });
      await act(async () => {
        fireEvent.click(removeBtn);
      });

      // Wait for second request to complete and update metrics
      await waitFor(() => {
        expect(screen.getByTestId("metric-distance")).toHaveTextContent("4.00 km");
      });

      // Now resolve the first (stale) request with an old distance (1000m)
      await act(async () => {
        resolveFirstRequest({
          ok: true,
          json: async () => ({
            code: "Ok",
            routes: [
              {
                geometry: { coordinates: [[-74.006, 40.7128], [-74.010, 40.7200]] },
                distance: 1000,
                duration: 500,
                legs: [],
              },
            ],
          }),
        });
      });

      // The final state must remain at distance from request 2 (4.00 km, 4000m), not the stale request 1 (1.00 km)
      expect(screen.getByTestId("metric-distance")).toHaveTextContent("4.00 km");
    });

    it("12. handles route calculation network error safely without crash", async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("router.project-osrm.org")) {
          return Promise.reject(new Error("Network failed"));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [] }),
        });
      });

      render(
        <Map
          location={defaultLocation}
          initialRoutingQueue={[sampleVenues[0], sampleVenues[1]]}
        />,
      );

      const moveDownBtn = screen.getByRole("button", { name: /Move Artisan Coffee down/i });
      await act(async () => {
        fireEvent.click(moveDownBtn);
      });

      await waitFor(() => {
        expect(screen.getByTestId("route-summary-error")).toBeInTheDocument();
        expect(screen.getByText(/Failed to calculate route/i)).toBeInTheDocument();
      });
    });
  });
});
