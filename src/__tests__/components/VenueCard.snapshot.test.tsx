import React from "react";
import { render } from "@testing-library/react";
import { VenueCard } from "@/components/VenueCard";
import { MapMarker } from "@/types/map";

// Mocks
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: jest.fn(),
    push: jest.fn(),
  }),
}));

jest.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ currency: "USD" }),
}));

jest.mock("@/hooks/useSeatAvailability", () => ({
  useSeatAvailability: () => ({
    availability: {
      "venue-1": { count: 12, capacity: 30 },
    },
  }),
}));

jest.mock("@/hooks/useHoverPredictor", () => ({
  useHoverPredictor: () => ({ current: null }),
}));

describe("VenueCard Visual Snapshot Tests", () => {
  const baseVenue: MapMarker = {
    id: "venue-1",
    name: "Artisan Coffee Roasters",
    address: "456 Market St, San Francisco, CA",
    position: { lat: 37.789, lng: -122.401 },
    category: "cafe",
    rating: 4.8,
    wifiQuality: true,
    hasOutlets: true,
    score: 9.2,
    isClaimed: true,
    openingHours: "08:00 - 18:00",
  };

  it("matches snapshot for standard verified venue card with live occupancy", () => {
    const { container } = render(
      <VenueCard
        venue={baseVenue}
        liveData={{ musicGenre: "lofi", count: 12, status: "Active" }}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot for venue card in selected compare mode", () => {
    const { container } = render(
      <VenueCard
        venue={baseVenue}
        isSelected={true}
        onToggleCompare={jest.fn()}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot for venue card with highlighted search query", () => {
    const { container } = render(
      <VenueCard
        venue={baseVenue}
        searchQuery="Artisan"
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot for quiet library venue card without outlets", () => {
    const libraryVenue: MapMarker = {
      ...baseVenue,
      id: "venue-2",
      name: "City Central Library",
      category: "library",
      hasOutlets: false,
      wifiQuality: true,
      score: 8.5,
    };
    const { container } = render(<VenueCard venue={libraryVenue} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
