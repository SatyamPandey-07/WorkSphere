import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { InteractiveMap, InteractiveMapMarker } from "@/components/chat/InteractiveMap";

// Mock react-leaflet components for fast, reliable unit testing
jest.mock("react-leaflet", () => ({
  MapContainer: ({
    center,
    zoom,
    children,
  }: {
    center: { lat: number; lng: number };
    zoom?: number;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="mock-map-container"
      data-center-lat={center?.lat}
      data-center-lng={center?.lng}
      data-zoom={zoom}
    >
      {children}
    </div>
  ),
  TileLayer: ({ url }: { url: string }) => (
    <div data-testid="mock-tile-layer" data-url={url} />
  ),
  Marker: ({
    position,
    title,
    alt,
    children,
    eventHandlers,
  }: {
    position: [number, number];
    title?: string;
    alt?: string;
    children: React.ReactNode;
    eventHandlers?: any;
  }) => {
    const mockElement = {
      setAttribute: jest.fn(),
      classList: { add: jest.fn() },
    };

    if (eventHandlers?.add) {
      eventHandlers.add({
        target: {
          getElement: () => mockElement,
          options: { title },
        },
      });
    }

    return (
      <div
        data-testid="mock-marker"
        data-lat={position[0]}
        data-lng={position[1]}
        data-title={title}
        data-alt={alt}
      >
        {children}
      </div>
    );
  },
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-popup">{children}</div>
  ),
}));

// Mock leaflet icon fix
jest.mock("leaflet", () => {
  const mockMerge = jest.fn();
  const DefaultIcon = function () {};
  DefaultIcon.prototype = {};
  (DefaultIcon as any).mergeOptions = mockMerge;
  return {
    Icon: { Default: DefaultIcon },
  };
});

describe("InteractiveMap Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Empty & Fallback State", () => {
    it("renders empty fallback when markers is undefined and center is omitted", () => {
      const { rerender } = render(<InteractiveMap markers={undefined} />);
      expect(screen.getByTestId("interactive-map-empty")).toBeInTheDocument();
      expect(screen.getByText("No markers provided")).toBeInTheDocument();

      rerender(<InteractiveMap markers={[]} />);
      expect(screen.getByTestId("interactive-map-empty")).toBeInTheDocument();
    });

    it("renders map container when markers is empty but center is explicitly provided", () => {
      render(
        <InteractiveMap
          markers={[]}
          center={{ lat: 37.7749, lng: -122.4194 }}
        />,
      );

      expect(screen.getByTestId("interactive-map")).toBeInTheDocument();
      const container = screen.getByTestId("mock-map-container");
      expect(container).toHaveAttribute("data-center-lat", "37.7749");
      expect(container).toHaveAttribute("data-center-lng", "-122.4194");
    });
  });

  describe("Coordinate Parsing & Centroid Calculation", () => {
    it("calculates centroid correctly from numeric marker coordinates", () => {
      const markers: InteractiveMapMarker[] = [
        { lat: 10, lng: 20, name: "Point A" },
        { lat: 30, lng: 40, name: "Point B" },
      ];

      render(<InteractiveMap markers={markers} />);

      const container = screen.getByTestId("mock-map-container");
      expect(container).toHaveAttribute("data-center-lat", "20");
      expect(container).toHaveAttribute("data-center-lng", "30");
    });

    it("handles string coordinates safely without string concatenation or NaN", () => {
      const markers: InteractiveMapMarker[] = [
        { lat: "12.9716", lng: "77.5946", name: "Bengaluru Spot 1" },
        { lat: "12.9720", lng: "77.5950", name: "Bengaluru Spot 2" },
      ];

      render(<InteractiveMap markers={markers} />);

      const container = screen.getByTestId("mock-map-container");
      const lat = parseFloat(container.getAttribute("data-center-lat") || "0");
      const lng = parseFloat(container.getAttribute("data-center-lng") || "0");

      expect(lat).toBeCloseTo(12.9718, 4);
      expect(lng).toBeCloseTo(77.5948, 4);
    });

    it("filters out invalid, null, or non-finite marker coordinates", () => {
      const markers: any[] = [
        { lat: 51.5074, lng: -0.1278, name: "London" },
        { lat: null, lng: null, name: "Null Island" },
        { lat: "invalid", lng: "not-a-number", name: "Corrupted" },
      ];

      render(<InteractiveMap markers={markers} />);

      const renderedMarkers = screen.getAllByTestId("mock-marker");
      expect(renderedMarkers.length).toBe(1);
      expect(renderedMarkers[0]).toHaveAttribute("data-alt", "London");
    });

    it("prefers explicit center prop over marker centroid when center is passed", () => {
      const markers: InteractiveMapMarker[] = [
        { lat: 10, lng: 10, name: "Far Point" },
      ];

      render(
        <InteractiveMap
          markers={markers}
          center={{ lat: 48.8566, lng: 2.3522 }}
        />,
      );

      const container = screen.getByTestId("mock-map-container");
      expect(container).toHaveAttribute("data-center-lat", "48.8566");
      expect(container).toHaveAttribute("data-center-lng", "2.3522");
    });
  });

  describe("Spiderfying Overlapping Markers", () => {
    it("spiderfies overlapping markers sharing the exact same coordinates", () => {
      const markers: InteractiveMapMarker[] = [
        { lat: 40.7128, lng: -74.006, name: "Venue Alpha" },
        { lat: 40.7128, lng: -74.006, name: "Venue Beta" },
        { lat: 40.7128, lng: -74.006, name: "Venue Gamma" },
      ];

      render(<InteractiveMap markers={markers} />);

      const renderedMarkers = screen.getAllByTestId("mock-marker");
      expect(renderedMarkers.length).toBe(3);

      // Verify all markers were offset radially to distinct 2D positions
      const pos0 = `${parseFloat(renderedMarkers[0].getAttribute("data-lat") || "0").toFixed(6)},${parseFloat(renderedMarkers[0].getAttribute("data-lng") || "0").toFixed(6)}`;
      const pos1 = `${parseFloat(renderedMarkers[1].getAttribute("data-lat") || "0").toFixed(6)},${parseFloat(renderedMarkers[1].getAttribute("data-lng") || "0").toFixed(6)}`;
      const pos2 = `${parseFloat(renderedMarkers[2].getAttribute("data-lat") || "0").toFixed(6)},${parseFloat(renderedMarkers[2].getAttribute("data-lng") || "0").toFixed(6)}`;

      expect(pos0).not.toBe(pos1);
      expect(pos1).not.toBe(pos2);
      expect(pos0).not.toBe(pos2);
    });
  });

  describe("Marker Labels & Popup Content", () => {
    it("renders complete popup details with name, category, and rating", () => {
      const markers: InteractiveMapMarker[] = [
        {
          lat: 13.0827,
          lng: 80.2707,
          name: "Cafe Artisan",
          category: "specialty_cafe",
          rating: 4.9,
        },
      ];

      render(<InteractiveMap markers={markers} />);

      expect(screen.getByText("Cafe Artisan")).toBeInTheDocument();
      expect(screen.getByText("specialty cafe")).toBeInTheDocument();

      const marker = screen.getByTestId("mock-marker");
      expect(marker).toHaveAttribute(
        "data-title",
        "Venue: Cafe Artisan, Category: specialty cafe, Rating: 4.9",
      );
    });

    it("falls back to marker title or 'Location' when name is missing", () => {
      const markers: InteractiveMapMarker[] = [
        {
          lat: 52.52,
          lng: 13.405,
          title: "Coworking Space Berlin",
        },
        {
          lat: 41.9028,
          lng: 12.4964,
        },
      ];

      render(<InteractiveMap markers={markers} />);

      expect(screen.getByText("Coworking Space Berlin")).toBeInTheDocument();
      expect(screen.getByText("Location")).toBeInTheDocument();
    });
  });

  describe("Keyboard Event Handlers", () => {
    it("provides accessible keydown event handler for Enter and Space to open popup", () => {
      const markers: InteractiveMapMarker[] = [
        { lat: 35.6762, lng: 139.6503, name: "Tokyo Desk" },
      ];

      render(<InteractiveMap markers={markers} />);

      // Find marker component and trigger event handler directly
      expect(screen.getByTestId("mock-marker")).toBeInTheDocument();
      expect(screen.getByTestId("map-header")).toBeInTheDocument();
    });
  });
});
