import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FloorPlanCanvas,
  getFloorPlanLOD,
  LOD_LOW_ZOOM_THRESHOLD,
  LOD_HIGH_ZOOM_THRESHOLD,
} from "@/components/venue/FloorPlanCanvas";

describe("FloorPlanCanvas Level-of-Detail (LOD) Zoom Rendering (#6492)", () => {
  describe("getFloorPlanLOD threshold checks", () => {
    it("returns 'low' for zoom below 0.8x", () => {
      expect(getFloorPlanLOD(0.4)).toBe("low");
      expect(getFloorPlanLOD(0.75)).toBe("low");
      expect(getFloorPlanLOD(LOD_LOW_ZOOM_THRESHOLD - 0.01)).toBe("low");
    });

    it("returns 'medium' for zoom between 0.8x and 1.5x inclusive", () => {
      expect(getFloorPlanLOD(0.8)).toBe("medium");
      expect(getFloorPlanLOD(1.0)).toBe("medium");
      expect(getFloorPlanLOD(1.2)).toBe("medium");
      expect(getFloorPlanLOD(1.5)).toBe("medium");
    });

    it("returns 'high' for zoom greater than 1.5x", () => {
      expect(getFloorPlanLOD(1.51)).toBe("high");
      expect(getFloorPlanLOD(1.8)).toBe("high");
      expect(getFloorPlanLOD(2.5)).toBe("high");
    });
  });

  describe("Low Zoom (< 0.8x) Rendering", () => {
    it("renders major zone boundaries and walls, hiding fine-grained seat elements", () => {
      render(<FloorPlanCanvas zoom={0.6} />);

      // Major zone boundaries & walls layer must be rendered
      expect(screen.getByTestId("zone-boundaries-layer")).toBeInTheDocument();
      expect(screen.getByTestId("zone-boundary-zone-quiet")).toBeInTheDocument();
      expect(screen.getByTestId("zone-boundary-zone-hotdesk")).toBeInTheDocument();

      // Low LOD overview banner is displayed
      expect(screen.getByTestId("low-lod-overview")).toBeInTheDocument();

      // Fine-grained seat layer is hidden to avoid DOM overload on mobile
      expect(screen.queryByTestId("fine-grained-seats-layer")).not.toBeInTheDocument();
      expect(screen.queryByTestId("power-socket-icon")).not.toBeInTheDocument();
      expect(screen.queryByTestId("chair-model")).not.toBeInTheDocument();
    });
  });

  describe("Medium Zoom (0.8x - 1.5x) Rendering", () => {
    it("renders individual seat buttons without high-LOD decorative furniture", () => {
      render(<FloorPlanCanvas zoom={1.0} />);

      expect(screen.getByTestId("zone-boundaries-layer")).toBeInTheDocument();
      expect(screen.getByTestId("fine-grained-seats-layer")).toBeInTheDocument();
      expect(screen.getByTestId("seat-seat_a1")).toBeInTheDocument();

      // At 1.0x (medium), power sockets and chair models should not clutter view
      expect(screen.queryByTestId("power-socket-icon")).not.toBeInTheDocument();
      expect(screen.queryByTestId("chair-model")).not.toBeInTheDocument();
    });
  });

  describe("High Zoom (> 1.5x) Rendering", () => {
    it("renders individual power socket icons, desk numbers, and chair models", () => {
      render(<FloorPlanCanvas zoom={1.8} />);

      expect(screen.getByTestId("fine-grained-seats-layer")).toBeInTheDocument();

      // High LOD elements
      const powerSockets = screen.getAllByTestId("power-socket-icon");
      expect(powerSockets.length).toBeGreaterThan(0);

      const chairModels = screen.getAllByTestId("chair-model");
      expect(chairModels.length).toBeGreaterThan(0);

      const deskNumbers = screen.getAllByTestId("high-lod-desk-number");
      expect(deskNumbers.length).toBeGreaterThan(0);
    });
  });

  describe("Zoom Controls Interaction", () => {
    it("updates zoom level and triggers onZoomChange callback", () => {
      const handleZoomChange = jest.fn();
      render(<FloorPlanCanvas onZoomChange={handleZoomChange} />);

      const zoomInBtn = screen.getByTestId("zoom-in-btn");
      fireEvent.click(zoomInBtn);

      expect(handleZoomChange).toHaveBeenCalledWith(1.25);
      expect(screen.getByTestId("zoom-level-display")).toHaveTextContent("125% (MEDIUM)");

      const zoomOutBtn = screen.getByTestId("zoom-out-btn");
      fireEvent.click(zoomOutBtn);
      fireEvent.click(zoomOutBtn);
      fireEvent.click(zoomOutBtn);

      // Now at 0.5x -> LOW
      expect(screen.getByTestId("zoom-level-display")).toHaveTextContent("50% (LOW)");
    });
  });
});
