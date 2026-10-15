import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  TacticalWaypointPill,
  formatTacticalWaypoint,
  VenueCard,
} from "@/components/VenueCard";

// Mock router and context for VenueCard tests
jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: jest.fn(), push: jest.fn() }),
}));

jest.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ currency: "USD", setCurrency: jest.fn() }),
}));

describe("TacticalWaypointPill and Aviation Coordinate Formatter", () => {
  describe("formatTacticalWaypoint", () => {
    it("formats Northern and Western coordinates correctly", () => {
      const result = formatTacticalWaypoint(37.7749, -122.4194);
      expect(result.waypointCode).toMatch(/^WP-\d{4}$/);
      expect(result.gridCoordinate).toBe("37.77°N 122.41°W");
      expect(result.formatted).toBe(`${result.waypointCode} // 37.77°N 122.41°W`);
      expect(result.fullDecimal).toBe("37.774900, -122.419400");
    });

    it("formats Southern and Eastern coordinates correctly", () => {
      const result = formatTacticalWaypoint(-33.8688, 151.2093);
      expect(result.waypointCode).toMatch(/^WP-\d{4}$/);
      expect(result.gridCoordinate).toBe("33.87°S 151.21°E");
      expect(result.formatted).toBe(`${result.waypointCode} // 33.87°S 151.21°E`);
      expect(result.fullDecimal).toBe("-33.868800, 151.209300");
    });
  });

  describe("TacticalWaypointPill Component", () => {
    it("renders with status role, accessible label, and monospaced typography", () => {
      render(
        <TacticalWaypointPill
          latitude={37.7749}
          longitude={-122.4194}
          venueName="Mission Workspace"
        />
      );

      const pill = screen.getByRole("status");
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveAttribute(
        "aria-label",
        expect.stringContaining("37.774900, -122.419400")
      );
      expect(screen.getByText("37.77°N 122.41°W")).toBeInTheDocument();
    });

    it("renders accessible tooltip with full decimal coordinates", () => {
      render(
        <TacticalWaypointPill
          latitude={37.7749}
          longitude={-122.4194}
          venueName="Mission Workspace"
        />
      );

      const tooltip = screen.getByRole("tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveTextContent("GPS: 37.774900, -122.419400");
      expect(tooltip).toHaveTextContent("Target: Mission Workspace");
    });

    it("flips to full tactical waypoint format on mouse hover", () => {
      render(
        <TacticalWaypointPill
          latitude={37.7749}
          longitude={-122.4194}
          venueName="Mission Workspace"
        />
      );

      const pill = screen.getByTestId("tactical-waypoint-pill");

      // Before hover: displays grid coordinate
      expect(screen.getByText("37.77°N 122.41°W")).toBeInTheDocument();

      // Trigger hover
      fireEvent.mouseEnter(pill);
      expect(screen.getByText(/\/\/ 37\.77°N 122\.41°W/)).toBeInTheDocument();

      // Trigger unhover
      fireEvent.mouseLeave(pill);
      expect(screen.getByText("37.77°N 122.41°W")).toBeInTheDocument();
    });
  });

  describe("VenueCard integration with showTacticalWaypoint", () => {
    const mockVenue: any = {
      id: "venue-tactical-1",
      name: "Top Gun Workspace",
      category: "coworking",
      address: "1 Fighter Way",
      position: { lat: 37.7749, lng: -122.4194 },
      rating: 4.9,
    };

    it("renders TacticalWaypointPill when showTacticalWaypoint is true", async () => {
      render(<VenueCard venue={mockVenue} showTacticalWaypoint={true} />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByTestId("tactical-waypoint-pill")).toBeInTheDocument();
      expect(screen.getByText("37.77°N 122.41°W")).toBeInTheDocument();
    });

    it("does not render TacticalWaypointPill when showTacticalWaypoint is omitted or false", async () => {
      render(<VenueCard venue={mockVenue} />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.queryByTestId("tactical-waypoint-pill")).not.toBeInTheDocument();
    });
  });
});
