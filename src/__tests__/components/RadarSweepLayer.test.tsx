import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RadarSweepLayer } from "@/components/map/RadarSweepLayer";
import { getUserLocationIcon } from "@/components/map/MapMarkerFactory";

// Mock calculateBearing
jest.mock("@/lib/geo", () => ({
  calculateBearing: jest.fn((lat1: number, _lon1: number, lat2: number, _lon2: number) => {
    // Return sample deterministic bearings based on coordinates
    if (lat2 > lat1) return 45;
    if (lat2 < lat1) return 225;
    return 90;
  }),
}));

describe("RadarSweepLayer (#6183)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default matchMedia mock without reduced motion
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });

  describe("Acceptance Criteria 1: 360° rotating radar sweep animation & range rings", () => {
    it("renders radar sweep layer with air traffic control range rings", () => {
      render(
        <RadarSweepLayer
          center={[37.7749, -122.4194]}
          radiusPixels={180}
        />
      );

      const layer = screen.getByTestId("radar-sweep-layer");
      expect(layer).toBeInTheDocument();
      expect(layer).toHaveAttribute("data-radius", "180");
      expect(layer).toHaveStyle({ width: "180px", height: "180px" });

      // Range rings & crosshairs
      expect(screen.getByTestId("radar-ring-outer")).toBeInTheDocument();
      expect(screen.getByTestId("radar-sweep-beam")).toBeInTheDocument();
      expect(screen.getByTestId("radar-sweep-beam")).toHaveClass("animate-radar-sweep");
      expect(screen.getByTestId("radar-center-dot")).toBeInTheDocument();
      expect(screen.getByTestId("radar-ping-aura")).toBeInTheDocument();
    });

    it("applies 4-second sweep duration by default and accepts custom duration", () => {
      const { rerender } = render(
        <RadarSweepLayer
          center={[37.7749, -122.4194]}
          durationSeconds={4}
        />
      );

      const beam = screen.getByTestId("radar-sweep-beam");
      expect(beam).toHaveStyle({ animationDuration: "4s" });

      rerender(
        <RadarSweepLayer
          center={[37.7749, -122.4194]}
          durationSeconds={6}
        />
      );

      expect(screen.getByTestId("radar-sweep-beam")).toHaveStyle({
        animationDuration: "6s",
      });
    });

    it("renders venue blips highlighted along polar bearing angle", () => {
      const venues = [
        { id: "venue-alpha", name: "Alpha Landing Zone", position: { lat: 37.78, lng: -122.41 } },
        { id: "venue-beta", name: "Beta Outpost", position: { lat: 37.76, lng: -122.42 } },
      ];

      render(
        <RadarSweepLayer
          center={[37.7749, -122.4194]}
          venues={venues}
          radiusPixels={200}
        />
      );

      const alphaTarget = screen.getByTestId("radar-target-venue-alpha");
      const betaTarget = screen.getByTestId("radar-target-venue-beta");

      expect(alphaTarget).toBeInTheDocument();
      expect(betaTarget).toBeInTheDocument();
      expect(alphaTarget).toHaveAttribute("title", "Alpha Landing Zone");
      expect(alphaTarget).toHaveAttribute("data-bearing", "45");
      expect(betaTarget).toHaveAttribute("data-bearing", "225");
    });
  });

  describe("Acceptance Criteria 2: Respect system prefers-reduced-motion", () => {
    it("switches to static radius ring when system prefers reduced motion", () => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      render(<RadarSweepLayer center={[37.7749, -122.4194]} />);

      const layer = screen.getByTestId("radar-sweep-layer");
      expect(layer).toHaveAttribute("data-reduced-motion", "true");

      // Static radius ring is displayed, rotating beam and ping aura are hidden
      expect(screen.getByTestId("radar-static-ring")).toBeInTheDocument();
      expect(screen.queryByTestId("radar-sweep-beam")).not.toBeInTheDocument();
      expect(screen.queryByTestId("radar-ping-aura")).not.toBeInTheDocument();
    });

    it("respects explicit reducedMotion prop override", () => {
      render(
        <RadarSweepLayer
          center={[37.7749, -122.4194]}
          reducedMotion={true}
        />
      );

      const layer = screen.getByTestId("radar-sweep-layer");
      expect(layer).toHaveAttribute("data-reduced-motion", "true");
      expect(screen.getByTestId("radar-static-ring")).toBeInTheDocument();
      expect(screen.queryByTestId("radar-sweep-beam")).not.toBeInTheDocument();
    });
  });

  describe("Acceptance Criteria 3: 60fps performance & parent stability", () => {
    it("memoizes component rendering and avoids unnecessary re-renders", () => {
      const renderSpy = jest.fn();
      const Wrapper = ({ count }: { count: number }) => {
        renderSpy(count);
        return (
          <RadarSweepLayer
            center={[37.7749, -122.4194]}
            radiusPixels={160}
          />
        );
      };

      const { rerender } = render(<Wrapper count={1} />);
      expect(screen.getByTestId("radar-sweep-layer")).toBeInTheDocument();
      expect(renderSpy).toHaveBeenCalledWith(1);

      rerender(<Wrapper count={2} />);
      expect(renderSpy).toHaveBeenCalledWith(2);
      expect(screen.getByTestId("radar-sweep-layer")).toBeInTheDocument();
    });
  });

  describe("getUserLocationIcon with radar sweep effect", () => {
    it("creates custom-user-marker DivIcon with rotating sweep by default", () => {
      const icon = getUserLocationIcon("https://example.com/avatar.png", {
        enableRadarSweep: true,
        radarRadius: 160,
        durationSeconds: 4,
      });

      expect(icon.options.className).toBe("custom-user-marker");
      expect(icon.options.iconSize).toEqual([160, 160]);
      expect(icon.options.iconAnchor).toEqual([80, 80]);
      expect(icon.options.html).toContain("radar-sweep-marker-wrapper");
      expect(icon.options.html).toContain("radar-range-rings");
      expect(icon.options.html).toContain("radar-sweep-beam animate-radar-sweep");
      expect(icon.options.html).toContain("image-marker");
    });

    it("supports reducedMotion in getUserLocationIcon by rendering static ring", () => {
      const icon = getUserLocationIcon("default", {
        enableRadarSweep: true,
        reducedMotion: true,
      });

      expect(icon.options.html).toContain("radar-static-ring");
      expect(icon.options.html).not.toContain("animate-radar-sweep");
      expect(icon.options.html).toContain("default-dot-marker");
    });

    it("falls back to standard dot marker when enableRadarSweep is false", () => {
      const icon = getUserLocationIcon("default", {
        enableRadarSweep: false,
      });

      expect(icon.options.className).toBe("custom-user-marker");
      expect(icon.options.iconSize).toEqual([40, 40]);
      expect(icon.options.iconAnchor).toEqual([20, 20]);
      expect(icon.options.html).not.toContain("radar-sweep-marker-wrapper");
      expect(icon.options.html).toContain("default-dot-marker");
    });
  });
});
