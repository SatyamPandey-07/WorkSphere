/// <reference types="jest" />
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { getVenueShape } from "@/lib/mapAccessibility";

// Mock Clerk
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: "test-user",
      hasImage: false,
      imageUrl: "",
    },
  }),
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue(null),
  }),
}));

// Mock PartySocket for presence
jest.mock("partysocket/react", () => {
  return jest.fn(() => ({
    send: jest.fn(),
    readyState: 1,
  }));
});

// Mock Seat Availability hook
jest.mock("@/hooks/useSeatAvailability", () => ({
  useSeatAvailability: () => ({
    availability: {},
    getAvailability: () => ({
      count: 0,
      capacity: 10,
      status: "green",
    }),
    checkIn: jest.fn(),
    checkOut: jest.fn(),
    checkedInVenueId: null,
    isConnected: true,
  }),
}));

// Mock react-leaflet
const mockOpenPopup = jest.fn();
const mockClosePopup = jest.fn();
const mockSetView = jest.fn();
const mockFlyTo = jest.fn();
const mockFlyToBounds = jest.fn();

jest.mock("react-leaflet", () => ({
  MapContainer: ({ children, center, zoom, style }: any) => (
    <div
      data-testid="map-container"
      data-center={JSON.stringify(center)}
      data-zoom={zoom}
      style={style}
    >
      {children}
    </div>
  ),
  TileLayer: ({ url, attribution }: any) => (
    <div
      data-testid="tile-layer"
      data-url={url}
      data-attribution={attribution}
    />
  ),
  Marker: React.forwardRef(function MockMarker(
    { children, position, icon, title, eventHandlers }: any,
    ref: any,
  ) {
    const elRef = React.useRef<HTMLDivElement>(null);

    React.useImperativeHandle(ref, () => ({
      getElement: () => elRef.current,
      getLatLng: () => ({ lat: position[0], lng: position[1] }),
      setLatLng: jest.fn(),
      setIcon: jest.fn(),
      openPopup: mockOpenPopup,
      closePopup: mockClosePopup,
    }));

    React.useEffect(() => {
      if (eventHandlers?.add && elRef.current) {
        eventHandlers.add({
          target: {
            getElement: () => elRef.current,
            options: { title },
            getPopup: () => null,
          },
        });
      }
    }, [eventHandlers, title]);

    return (
      <div
        ref={elRef}
        data-testid="marker"
        data-position={JSON.stringify(position)}
        data-icon-class={icon?.options?.className || "default"}
        data-icon-html={icon?.options?.html || ""}
        onClick={eventHandlers?.click}
        onKeyDown={(e) => {
          if (eventHandlers?.keydown) {
            const mockOriginalEvent = {
              key: e.key,
              preventDefault: jest.fn(),
            };
            eventHandlers.keydown({
              originalEvent: mockOriginalEvent,
              target: {
                openPopup: mockOpenPopup,
                closePopup: mockClosePopup,
              },
            });
          }
        }}
      >
        {children}
      </div>
    );
  }),
  Popup: ({ children }: any) => <div data-testid="popup">{children}</div>,
  Polyline: ({ children }: any) => <div data-testid="polyline">{children}</div>,
  useMap: () => ({
    setView: mockSetView,
    flyTo: mockFlyTo,
    flyToBounds: mockFlyToBounds,
    getZoom: jest.fn(() => 13),
    on: jest.fn(),
    off: jest.fn(),
  }),
  LayersControl: Object.assign(
    ({ children }: any) => <div data-testid="layers-control">{children}</div>,
    {
      BaseLayer: ({ children }: any) => (
        <div data-testid="base-layer">{children}</div>
      ),
      Overlay: ({ children, name, checked }: any) => (
        <div data-testid="overlay" data-name={name} data-checked={checked}>
          {children}
        </div>
      ),
    },
  ),
  LayerGroup: ({ children }: any) => (
    <div data-testid="layer-group">{children}</div>
  ),
  CircleMarker: () => <div data-testid="circle-marker" />,
  ScaleControl: ({ position }: any) => (
    <div data-testid="scale-control" data-position={position} />
  ),
}));

// Mock leaflet divIcon
jest.mock("leaflet", () => ({
  icon: jest.fn(() => ({ options: { className: "default-icon" } })),
  divIcon: jest.fn((options) => ({ options })),
  latLngBounds: jest.fn(() => ({
    extend: jest.fn(),
  })),
  Icon: {
    Default: {
      prototype: {},
      mergeOptions: jest.fn(),
    },
  },
}));

import Map from "@/components/Map";
import { MapMarker } from "@/types/map";

describe("Map Marker Accessibility (Issue #3446)", () => {
  const defaultLocation = { latitude: 37.7749, longitude: -122.4194 };
  const mockMarkers: MapMarker[] = [
    {
      id: "venue-cafe",
      name: "Artisan Coffee Cafe",
      category: "cafe",
      score: 4.8,
      position: { lat: 37.775, lng: -122.419 },
    },
    {
      id: "venue-coworking",
      name: "Hive Coworking Hub",
      category: "coworking",
      score: 4.6,
      position: { lat: 37.776, lng: -122.418 },
    },
    {
      id: "venue-library",
      name: "Civic Center Library",
      category: "library",
      score: 4.9,
      position: { lat: 37.777, lng: -122.417 },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Focus Ring Indicators (Scope & Requirements 1)", () => {
    it("renders high-visibility focus indicators with var(--primary-accent) and 2px offset in styles", () => {
      const { container } = render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
        />,
      );

      const styleEl = container.querySelector("style");
      expect(styleEl).not.toBeNull();
      const css = styleEl?.innerHTML || "";

      // Must specify outline: 3px solid var(--primary-accent) and outline-offset: 2px
      expect(css).toContain("outline: 3px solid var(--primary-accent)");
      expect(css).toContain("outline-offset: 2px");
    });

    it("assigns keyboard focus semantics (role='button', tabindex='0', and interactive-map-pin) to markers", () => {
      render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
        />,
      );

      const markers = screen.getAllByTestId("marker");
      // Find venue markers
      const venueMarkers = markers.filter(
        (m) =>
          m.getAttribute("aria-label")?.includes("Artisan Coffee Cafe") ||
          m.getAttribute("aria-label")?.includes("Hive Coworking Hub") ||
          m.getAttribute("aria-label")?.includes("Civic Center Library"),
      );

      expect(venueMarkers.length).toBe(3);
      venueMarkers.forEach((marker) => {
        expect(marker).toHaveAttribute("role", "button");
        expect(marker).toHaveAttribute("tabindex", "0");
        expect(marker).toHaveClass("interactive-map-pin");
      });
    });
  });

  describe("Keyboard Traversal (Scope & Requirements 1 & 3)", () => {
    it("supports sequential Tab focus traversal across markers", () => {
      render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
        />,
      );

      const markers = screen.getAllByTestId("marker");
      const venueMarkers = markers.filter(
        (m) =>
          m.getAttribute("aria-label")?.includes("Artisan Coffee Cafe") ||
          m.getAttribute("aria-label")?.includes("Hive Coworking Hub") ||
          m.getAttribute("aria-label")?.includes("Civic Center Library"),
      );

      expect(venueMarkers.length).toBe(3);

      // Traversal simulation: each marker is focusable in tab sequence
      venueMarkers.forEach((marker, index) => {
        marker.focus();
        expect(document.activeElement).toBe(marker);
        expect(marker).toHaveAttribute("tabindex", "0");
      });
    });

    it("triggers popup on Enter key navigation", () => {
      render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
        />,
      );

      const cafeMarker = screen
        .getAllByTestId("marker")
        .find((m) =>
          m.getAttribute("aria-label")?.includes("Artisan Coffee Cafe"),
        )!;

      fireEvent.keyDown(cafeMarker, { key: "Enter" });
      expect(mockOpenPopup).toHaveBeenCalledTimes(1);
    });

    it("triggers popup on Space key navigation", () => {
      render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
        />,
      );

      const coworkingMarker = screen
        .getAllByTestId("marker")
        .find((m) =>
          m.getAttribute("aria-label")?.includes("Hive Coworking Hub"),
        )!;

      fireEvent.keyDown(coworkingMarker, { key: " " });
      expect(mockOpenPopup).toHaveBeenCalledTimes(1);
    });

    it("dismisses popup on Escape key press", () => {
      render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
        />,
      );

      const libraryMarker = screen
        .getAllByTestId("marker")
        .find((m) =>
          m.getAttribute("aria-label")?.includes("Civic Center Library"),
        )!;

      fireEvent.keyDown(libraryMarker, { key: "Escape" });
      expect(mockClosePopup).toHaveBeenCalledTimes(1);
    });
  });

  describe("High-Contrast Mode Toggle & Distinct Shape Glyphs (Scope & Requirements 2)", () => {
    it("renders a high-contrast mode toggle in map control options with proper ARIA attributes", () => {
      render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
        />,
      );

      const toggleButton = screen.getByRole("switch", {
        name: /Toggle high-contrast mode/i,
      });
      expect(toggleButton).toBeInTheDocument();
      expect(toggleButton).toHaveAttribute("aria-checked", "false");
      expect(toggleButton).toHaveTextContent("High Contrast");
    });

    it("toggles high-contrast mode and invokes onHighContrastChange", () => {
      const onHighContrastChange = jest.fn();
      render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
          onHighContrastChange={onHighContrastChange}
        />,
      );

      const toggleButton = screen.getByRole("switch", {
        name: /Toggle high-contrast mode/i,
      });

      act(() => {
        fireEvent.click(toggleButton);
      });

      expect(toggleButton).toHaveAttribute("aria-checked", "true");
      expect(onHighContrastChange).toHaveBeenCalledWith(true);

      act(() => {
        fireEvent.click(toggleButton);
      });

      expect(toggleButton).toHaveAttribute("aria-checked", "false");
      expect(onHighContrastChange).toHaveBeenCalledWith(false);
    });

    it("renders circle glyph for cafe, square for coworking, and diamond for library in high-contrast mode", () => {
      render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
          initialHighContrast={true}
        />,
      );

      // Find venue markers
      const cafeMarker = screen
        .getAllByTestId("marker")
        .find((m) =>
          m.getAttribute("aria-label")?.includes("Artisan Coffee Cafe"),
        )!;
      const coworkingMarker = screen
        .getAllByTestId("marker")
        .find((m) =>
          m.getAttribute("aria-label")?.includes("Hive Coworking Hub"),
        )!;
      const libraryMarker = screen
        .getAllByTestId("marker")
        .find((m) =>
          m.getAttribute("aria-label")?.includes("Civic Center Library"),
        )!;

      // 1. Cafe: Circle glyph
      expect(cafeMarker).toHaveAttribute("data-high-contrast", "true");
      expect(cafeMarker).toHaveAttribute("data-shape", "circle");
      expect(cafeMarker.getAttribute("data-icon-class")).toContain(
        "hc-marker-circle",
      );
      expect(cafeMarker.getAttribute("data-icon-html")).toContain(
        "hc-shape-circle",
      );

      // 2. Coworking: Square glyph
      expect(coworkingMarker).toHaveAttribute("data-high-contrast", "true");
      expect(coworkingMarker).toHaveAttribute("data-shape", "square");
      expect(coworkingMarker.getAttribute("data-icon-class")).toContain(
        "hc-marker-square",
      );
      expect(coworkingMarker.getAttribute("data-icon-html")).toContain(
        "hc-shape-square",
      );

      // 3. Library: Diamond glyph
      expect(libraryMarker).toHaveAttribute("data-high-contrast", "true");
      expect(libraryMarker).toHaveAttribute("data-shape", "diamond");
      expect(libraryMarker.getAttribute("data-icon-class")).toContain(
        "hc-marker-diamond",
      );
      expect(libraryMarker.getAttribute("data-icon-html")).toContain(
        "hc-shape-diamond",
      );
    });

    it("maps categories accurately with getVenueShape helper", () => {
      expect(getVenueShape("cafe")).toBe("circle");
      expect(getVenueShape("Coffee Shop")).toBe("circle");
      expect(getVenueShape("coworking")).toBe("square");
      expect(getVenueShape("Workspace / Office")).toBe("square");
      expect(getVenueShape("library")).toBe("diamond");
      expect(getVenueShape("Study Library")).toBe("diamond");
      expect(getVenueShape(undefined)).toBe("circle");
    });

    it("includes high-contrast mode overlay option in LayersControl", () => {
      render(
        <Map
          location={defaultLocation}
          markers={mockMarkers}
          routes={[]}
          mapView={null}
        />,
      );

      const overlays = screen.getAllByTestId("overlay");
      const highContrastOverlay = overlays.find((o) =>
        o.getAttribute("data-name")?.includes("High-Contrast Mode"),
      );
      expect(highContrastOverlay).toBeDefined();
    });
  });
});
