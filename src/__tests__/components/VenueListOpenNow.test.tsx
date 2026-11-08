import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueList, isVenueCurrentlyOpen } from "@/components/venues/VenueList";

// Mock VenueCard
jest.mock("@/components/VenueCard", () => ({
  VenueCard: ({ venue }: any) => (
    <div data-testid={`venue-card-${venue.id}`}>
      <h3>{venue.name}</h3>
      <span>{venue.isOpen ? "Open" : "Closed"}</span>
    </div>
  ),
}));

describe("VenueList 'Open Now' Quick Filter Chip (#5057)", () => {
  const mockVenues = [
    {
      id: "venue-open-1",
      name: "Sunrise Workspace & Roastery",
      isOpen: true,
      latitude: 37.7749,
      longitude: -122.4194,
    },
    {
      id: "venue-closed-2",
      name: "Night Owls Midnight Club",
      isOpen: false,
      latitude: 37.7849,
      longitude: -122.4094,
    },
    {
      id: "venue-hours-open-3",
      name: "24/7 Digital Den",
      hours: "Open 24 Hours",
      latitude: 37.7949,
      longitude: -122.3994,
    },
  ];

  describe("isVenueCurrentlyOpen helper", () => {
    it("identifies explicitly open / closed venues", () => {
      expect(isVenueCurrentlyOpen({ isOpen: true })).toBe(true);
      expect(isVenueCurrentlyOpen({ openNow: true })).toBe(true);
      expect(isVenueCurrentlyOpen({ isOpen: false })).toBe(false);
      expect(isVenueCurrentlyOpen({ openNow: false })).toBe(false);
      expect(isVenueCurrentlyOpen(null)).toBe(false);
    });

    it("evaluates operating hours strings", () => {
      expect(isVenueCurrentlyOpen({ hours: "Open 24/7" })).toBe(true);
      expect(isVenueCurrentlyOpen({ hours: "00:00 - 24:00" })).toBe(true);
    });
  });

  describe("Filter Chip Interaction in VenueList", () => {
    it("renders all venues by default and displays Open Now filter chip", () => {
      render(<VenueList venues={mockVenues} />);

      const filterChip = screen.getByTestId("open-now-filter-chip");
      expect(filterChip).toBeInTheDocument();
      expect(filterChip).toHaveAttribute("aria-pressed", "false");

      expect(screen.getByTestId("venue-card-venue-open-1")).toBeInTheDocument();
      expect(screen.getByTestId("venue-card-venue-closed-2")).toBeInTheDocument();
      expect(screen.getByTestId("venue-card-venue-hours-open-3")).toBeInTheDocument();
    });

    it("filters out closed venues when Open Now filter chip is clicked", () => {
      render(<VenueList venues={mockVenues} />);

      const filterChip = screen.getByTestId("open-now-filter-chip");
      fireEvent.click(filterChip);

      expect(filterChip).toHaveAttribute("aria-pressed", "true");

      // Open venues are shown
      expect(screen.getByTestId("venue-card-venue-open-1")).toBeInTheDocument();
      expect(screen.getByTestId("venue-card-venue-hours-open-3")).toBeInTheDocument();

      // Closed venue is excluded
      expect(screen.queryByTestId("venue-card-venue-closed-2")).not.toBeInTheDocument();

      // Clicking again toggles off the filter
      fireEvent.click(filterChip);
      expect(filterChip).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("venue-card-venue-closed-2")).toBeInTheDocument();
    });

    it("displays empty state message when no venues are open and filter is active", () => {
      const closedVenuesOnly = [
        {
          id: "venue-closed-only",
          name: "Closed Cafe",
          isOpen: false,
        },
      ];

      render(<VenueList venues={closedVenuesOnly} />);

      const filterChip = screen.getByTestId("open-now-filter-chip");
      fireEvent.click(filterChip);

      const emptyMsg = screen.getByTestId("venue-list-empty");
      expect(emptyMsg).toBeInTheDocument();
      expect(emptyMsg).toHaveTextContent("No venues currently open matching your criteria.");
    });
  });
});
