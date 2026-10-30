import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import VenueListDefault, {
  VenueList,
  isVenueCurrentlyOpen,
} from "@/components/venues/VenueList";

jest.mock("@/components/VenueCard", () => ({
  VenueCard: ({ venue, onSaveFavorite }: any) => (
    <div data-testid={`mock-venue-card-${venue.id || venue.placeId}`}>
      <span>{venue.name}</span>
      {onSaveFavorite && (
        <button
          data-testid={`bookmark-btn-${venue.id || venue.placeId}`}
          onClick={() => onSaveFavorite({ id: venue.id || venue.placeId })}
        >
          Bookmark
        </button>
      )}
    </div>
  ),
}));

describe("VenueList Component Suite", () => {
  const sampleVenues = [
    {
      id: "venue-1",
      name: "Downtown Cafe",
      latitude: 37.7749,
      longitude: -122.4194,
      openNow: true,
    },
    {
      id: "venue-2",
      name: "Uptown Workspace",
      latitude: 37.7849,
      longitude: -122.4094,
      openNow: false,
    },
    {
      id: "venue-3",
      name: "Midtown Studio",
      lat: 37.7949,
      lng: -122.3994,
      openNow: true,
    },
  ];

  it("exports default component matching named export", () => {
    expect(VenueListDefault).toBe(VenueList);
  });

  describe("Defensive Null / Undefined Guards", () => {
    it("handles omitted venues without throwing and displays empty fallback", () => {
      render(<VenueList />);

      expect(screen.getByTestId("venue-list")).toBeInTheDocument();
      expect(screen.getByTestId("venue-list-empty")).toBeInTheDocument();
      expect(screen.getByTestId("venue-list-empty")).toHaveTextContent(
        "No venues found matching your distance and location criteria."
      );
    });

    it("handles undefined and null venues without throwing", () => {
      const { rerender } = render(<VenueList venues={undefined} />);
      expect(screen.getByTestId("venue-list-empty")).toBeInTheDocument();

      rerender(<VenueList venues={null as any} />);
      expect(screen.getByTestId("venue-list-empty")).toBeInTheDocument();
    });
  });

  describe("Venue Grid & Filters", () => {
    it("renders venue cards in responsive grid", () => {
      render(<VenueList venues={sampleVenues} />);

      expect(screen.getByTestId("venue-list-grid")).toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-1")).toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-2")).toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-3")).toBeInTheDocument();
    });

    it("toggles 'Open Now' filter chip and updates list", () => {
      render(<VenueList venues={sampleVenues} />);

      const filterBtn = screen.getByTestId("open-now-filter-chip");
      expect(filterBtn).toBeInTheDocument();
      expect(filterBtn).toHaveAttribute("aria-pressed", "false");

      // Click Open Now filter
      fireEvent.click(filterBtn);
      expect(filterBtn).toHaveAttribute("aria-pressed", "true");

      // Closed venue-2 should be filtered out
      expect(screen.getByTestId("mock-venue-card-venue-1")).toBeInTheDocument();
      expect(screen.queryByTestId("mock-venue-card-venue-2")).not.toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-3")).toBeInTheDocument();

      // Click again to deactivate filter
      fireEvent.click(filterBtn);
      expect(filterBtn).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("mock-venue-card-venue-2")).toBeInTheDocument();
    });

    it("displays appropriate empty message when Open Now yields zero results", () => {
      const closedVenues = [
        { id: "v-closed", name: "Closed Spot", openNow: false },
      ];
      render(<VenueList venues={closedVenues} />);

      fireEvent.click(screen.getByTestId("open-now-filter-chip"));

      expect(screen.getByTestId("venue-list-empty")).toHaveTextContent(
        "No venues currently open matching your criteria."
      );
    });

    it("hides Open Now filter chip when showOpenNowFilter is false", () => {
      render(<VenueList venues={sampleVenues} showOpenNowFilter={false} />);

      expect(screen.queryByTestId("open-now-filter-chip")).not.toBeInTheDocument();
    });
  });

  describe("Distance & Proximity", () => {
    const userLocation = { lat: 37.7749, lng: -122.4194 };

    it("renders distance badge and sr-only walking badge when userLocation is supplied", () => {
      render(<VenueList venues={sampleVenues} userLocation={userLocation} />);

      const badge1 = screen.getByTestId("distance-badge-venue-1");
      expect(badge1).toBeInTheDocument();
      expect(badge1).toHaveTextContent("0.0 km away");

      const walking1 = screen.getByTestId("walking-badge-venue-1");
      expect(walking1).toBeInTheDocument();
    });

    it("filters venues within maxDistanceKm radius", () => {
      // 1.5 km should include venue-1 (0 km) and venue-2 (~1.4 km), but not venue-3 (~2.8 km)
      render(
        <VenueList
          venues={sampleVenues}
          userLocation={userLocation}
          maxDistanceKm={2.0}
        />
      );

      expect(screen.getByTestId("mock-venue-card-venue-1")).toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-2")).toBeInTheDocument();
      expect(screen.queryByTestId("mock-venue-card-venue-3")).not.toBeInTheDocument();
    });

    it("sorts venues by proximity when sortByProximity is enabled", () => {
      // Reversed location: user near venue-3
      const farLocation = { lat: 37.7949, lng: -122.3994 };
      render(
        <VenueList
          venues={sampleVenues}
          userLocation={farLocation}
          sortByProximity={true}
        />
      );

      const cards = screen.getAllByTestId(/mock-venue-card-/);
      expect(cards[0]).toHaveTextContent("Midtown Studio"); // closest
    });
  });

  describe("Bookmark Callback & Custom Styling", () => {
    it("invokes onBookmarkToggle callback when bookmark is clicked", () => {
      const handleBookmark = jest.fn();
      render(
        <VenueList venues={sampleVenues} onBookmarkToggle={handleBookmark} />
      );

      const bookmarkBtn = screen.getByTestId("bookmark-btn-venue-1");
      fireEvent.click(bookmarkBtn);

      expect(handleBookmark).toHaveBeenCalledWith("venue-1");
    });

    it("applies custom className and data-testid overrides", () => {
      render(
        <VenueList
          venues={sampleVenues}
          className="custom-grid-style"
          data-testid="custom-venue-list-root"
        />
      );

      expect(screen.getByTestId("custom-venue-list-root")).toBeInTheDocument();
      const grid = screen.getByTestId("venue-list-grid");
      expect(grid.className).toContain("custom-grid-style");
    });
  });

  describe("isVenueCurrentlyOpen Helper", () => {
    it("returns false for falsy venue", () => {
      expect(isVenueCurrentlyOpen(null)).toBe(false);
      expect(isVenueCurrentlyOpen(undefined)).toBe(false);
    });

    it("returns explicit boolean status if present", () => {
      expect(isVenueCurrentlyOpen({ openNow: true })).toBe(true);
      expect(isVenueCurrentlyOpen({ openNow: false })).toBe(false);
      expect(isVenueCurrentlyOpen({ isOpen: true })).toBe(true);
      expect(isVenueCurrentlyOpen({ isOpen: false })).toBe(false);
    });
  });
});
