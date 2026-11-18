import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  TacticalAirspaceMap,
  getAltitudeColor,
  clusterVenues,
  type VenueMarker,
  type AirspaceCorridor,
} from "@/components/map/TacticalAirspaceMap";

// Mock Canvas 2D context for JSDOM
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    arc: jest.fn(),
    closePath: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    setLineDash: jest.fn(),
    strokeRect: jest.fn(),
    fillText: jest.fn(),
    createRadialGradient: jest.fn(() => ({
      addColorStop: jest.fn(),
    })),
    strokeStyle: "#000",
    fillStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    font: "10px sans-serif",
    textAlign: "left",
  })) as any;
});

describe("TacticalAirspaceMap WebGL Vector Tactical Airspace (#6329)", () => {
  const mockVenues: VenueMarker[] = [
    {
      id: "venue-1",
      name: "Coast City Cyber Outpost",
      x: 100,
      y: 200,
      category: "hub",
      capacity: 100,
      currentOccupancy: 65,
      altitudeLevel: "FL015",
      floors: [
        { floorNumber: 1, name: "Concourse", desksAvailable: 15, totalDesks: 50 },
        { floorNumber: 2, name: "Sky Deck", desksAvailable: 20, totalDesks: 50 },
      ],
    },
    {
      id: "venue-2",
      name: "Ferris Avionics Lab",
      x: 500,
      y: 350,
      category: "lab",
      capacity: 80,
      currentOccupancy: 45,
      altitudeLevel: "FL040",
      floors: [
        { floorNumber: 1, name: "Main Lab", desksAvailable: 35, totalDesks: 80 },
      ],
    },
  ];

  const mockCorridors: AirspaceCorridor[] = [
    {
      id: "corridor-low",
      name: "LOW APPROACH",
      altitudeFloor: 400,
      altitudeCeiling: 800,
      points: [
        [50, 100],
        [150, 200],
      ],
      status: "clear",
    },
    {
      id: "corridor-high",
      name: "SUPERSONIC HIGHWAY",
      altitudeFloor: 3200,
      altitudeCeiling: 4500,
      points: [
        [400, 300],
        [600, 450],
      ],
      status: "clear",
    },
  ];

  describe("Altitude Color & Corridor Ribbon Mapping", () => {
    it("maps low altitude (<1000ft) to cyan corridor color", () => {
      const color = getAltitudeColor(800);
      expect(color.stroke).toBe("#06b6d4");
      expect(color.label).toContain("LOW CORRIDOR");
    });

    it("maps tactical sector (1000-3000ft) to emerald color", () => {
      const color = getAltitudeColor(2200);
      expect(color.stroke).toBe("#10b981");
      expect(color.label).toContain("TACTICAL SECTOR");
    });

    it("maps high supersonic altitude (>3000ft) to lime green color", () => {
      const color = getAltitudeColor(4200);
      expect(color.stroke).toBe("#a3e635");
      expect(color.label).toContain("SUPERSONIC VECTOR");
    });
  });

  describe("Venue Clustering Logic", () => {
    it("groups nearby venues into a cluster when zoom level is low", () => {
      const denseVenues: VenueMarker[] = [
        { ...mockVenues[0], id: "v1", x: 100, y: 100 },
        { ...mockVenues[0], id: "v2", x: 110, y: 115 },
        { ...mockVenues[0], id: "v3", x: 120, y: 110 },
        { ...mockVenues[0], id: "v4", x: 600, y: 500 },
        { ...mockVenues[0], id: "v5", x: 610, y: 510 },
      ];

      const clusters = clusterVenues(denseVenues, 60, 1.0);
      expect(clusters.some((c) => c.isCluster && c.points.length === 3)).toBe(true);
    });

    it("expands all clusters into individual markers at high zoom level", () => {
      const denseVenues: VenueMarker[] = [
        { ...mockVenues[0], id: "v1", x: 100, y: 100 },
        { ...mockVenues[0], id: "v2", x: 105, y: 105 },
        { ...mockVenues[0], id: "v3", x: 110, y: 110 },
        { ...mockVenues[0], id: "v4", x: 115, y: 115 },
        { ...mockVenues[0], id: "v5", x: 120, y: 120 },
      ];

      const clusters = clusterVenues(denseVenues, 60, 2.5);
      expect(clusters.every((c) => !c.isCluster)).toBe(true);
      expect(clusters).toHaveLength(5);
    });
  });

  describe("Component Rendering & Interactions", () => {
    it("renders map container, radar canvas, and telemetry bar", () => {
      render(
        <TacticalAirspaceMap
          venueMarkers={mockVenues}
          corridors={mockCorridors}
          flightCallsign="HAL-JORDAN // F-22 RAPTOR"
        />,
      );

      expect(screen.getByTestId("tactical-airspace-map")).toBeInTheDocument();
      expect(screen.getByTestId("airspace-webgl-canvas")).toBeInTheDocument();
      expect(screen.getByText(/HAL-JORDAN \/\/ F-22 RAPTOR/i)).toBeInTheDocument();
      expect(screen.getByTestId("tactical-engine-badge")).toBeInTheDocument();
    });

    it("supports toggling corridor ribbons on and off", () => {
      render(<TacticalAirspaceMap corridors={mockCorridors} />);

      const toggleBtn = screen.getByTestId("toggle-corridors-button");
      expect(toggleBtn).toBeInTheDocument();

      fireEvent.click(toggleBtn);
      // Click again to toggle back
      fireEvent.click(toggleBtn);
    });

    it("supports zooming in, zooming out, and resetting view", () => {
      render(<TacticalAirspaceMap />);

      const zoomInBtn = screen.getByTestId("zoom-in-button");
      const zoomOutBtn = screen.getByTestId("zoom-out-button");
      const resetBtn = screen.getByTestId("reset-view-button");

      fireEvent.click(zoomInBtn);
      fireEvent.click(zoomOutBtn);
      fireEvent.click(resetBtn);
    });

    it("supports clicking a venue marker to open floorplan drill-down", () => {
      const handleSelectVenue = jest.fn();
      render(
        <TacticalAirspaceMap
          venueMarkers={mockVenues}
          onSelectVenue={handleSelectVenue}
        />,
      );

      const marker = screen.getByTestId("venue-marker-venue-1");
      fireEvent.click(marker);

      expect(handleSelectVenue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "venue-1" }),
      );

      // Floorplan modal opens
      expect(screen.getByTestId("venue-floorplan-modal")).toBeInTheDocument();
      expect(screen.getByText("Coast City Cyber Outpost")).toBeInTheDocument();
      expect(screen.getByTestId("floor-tab-1")).toBeInTheDocument();
      expect(screen.getByTestId("floor-tab-2")).toBeInTheDocument();

      // Switch floor levels
      fireEvent.click(screen.getByTestId("floor-tab-2"));
      expect(screen.getByText("Sky Deck")).toBeInTheDocument();

      // Close modal
      const closeBtn = screen.getByTestId("close-floorplan-button");
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId("venue-floorplan-modal")).not.toBeInTheDocument();
    });

    it("supports clicking waypoints to fire onSelectWaypoint callback", () => {
      const handleSelectWp = jest.fn();
      render(
        <TacticalAirspaceMap
          waypoints={[
            { id: "wp-alpha", name: "Waypoint Alpha", coordinates: [150, 250], type: "waypoint" },
          ]}
          onSelectWaypoint={handleSelectWp}
        />,
      );

      const wp = screen.getByTestId("waypoint-pin-wp-alpha");
      fireEvent.click(wp);

      expect(handleSelectWp).toHaveBeenCalledWith(
        expect.objectContaining({ id: "wp-alpha" }),
      );
    });

    it("supports forceFallback prop for vector SVG fallback mode", () => {
      render(<TacticalAirspaceMap forceFallback={true} />);
      const badge = screen.getByTestId("tactical-engine-badge");
      expect(badge).toHaveTextContent(/VECTOR SVG FALLBACK/i);
    });
  });
});
