import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueList } from "@/components/venues/VenueList";

// Mock VenueCard to keep test lightweight
jest.mock("@/components/VenueCard", () => ({
  VenueCard: ({ venue }: any) => (
    <div data-testid={`venue-card-${venue.id}`}>
      <h3>{venue.name}</h3>
    </div>
  ),
}));

describe("VenueList Distance Badge Indicator (#5060)", () => {
  const mockVenues = [
    {
      id: "venue-alpha",
      name: "Downtown Coffee",
      latitude: 37.7749,
      longitude: -122.4194,
      address: "123 Main St",
    },
    {
      id: "venue-beta",
      name: "Library Hub",
      latitude: 37.7849,
      longitude: -122.4094,
      address: "456 Market St",
    },
  ];

  it("calculates distance from user GPS coordinates and renders corner badge", () => {
    // User is near venue-alpha (approx ~1.4 km from venue-beta)
    const userLocation = { lat: 37.7749, lng: -122.4194 };

    render(<VenueList venues={mockVenues} userLocation={userLocation} />);

    // Venue Alpha is at identical coordinates -> 0.0 km away
    const badgeAlpha = screen.getByTestId("distance-badge-venue-alpha");
    expect(badgeAlpha).toBeInTheDocument();
    expect(badgeAlpha).toHaveTextContent("0.0 km away");

    // Venue Beta is approx 1.4 km away
    const badgeBeta = screen.getByTestId("distance-badge-venue-beta");
    expect(badgeBeta).toBeInTheDocument();
    expect(badgeBeta).toHaveTextContent("1.4 km away");
  });

  it("hides badge gracefully when location access is denied / null", () => {
    render(<VenueList venues={mockVenues} userLocation={null} />);

    expect(screen.queryByTestId("distance-badge-venue-alpha")).not.toBeInTheDocument();
    expect(screen.queryByTestId("distance-badge-venue-beta")).not.toBeInTheDocument();
  });
});
