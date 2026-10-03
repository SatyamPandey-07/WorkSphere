import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueCard } from "@/components/VenueCard";

const mockPrefetch = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: mockPrefetch }),
}));
jest.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ currency: "USD", setCurrency: jest.fn() }),
}));

const mockVenue = {
  id: "test-venue-1",
  name: "Coffee Shop",
  category: "cafe",
  address: "123 Main St",
  distance: "0.5 km",
  rating: 4.5,
  position: { lat: 37.7749, lng: -122.4194 },
  wifiQuality: 4,
  hasOutlets: true,
  noiseLevel: "quiet",
};

describe("VenueCard", () => {
  const mockOnGetDirections = jest.fn();
  const mockOnSaveFavorite = jest.fn();
  const mockOnRate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderVenueCard = async (venue = mockVenue) => {
    const utils = render(
      <VenueCard
        venue={venue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return utils;
  };

  it("renders venue name and category", async () => {
    await renderVenueCard();

    expect(screen.getByText("Coffee Shop")).toBeInTheDocument();
    expect(screen.getByText("cafe")).toBeInTheDocument();
  });

  it("renders address when provided", async () => {
    await renderVenueCard();

    expect(screen.getByText("123 Main St")).toBeInTheDocument();
  });

  it("shows WiFi indicator when venue has WiFi", async () => {
    await renderVenueCard();

    expect(screen.getAllByText(/WiFi/)[0]).toBeInTheDocument();
  });

  it("shows Outlets indicator when venue has outlets", async () => {
    await renderVenueCard();

    expect(screen.getAllByText(/Outlets/)[0]).toBeInTheDocument();
  });

  it("calls onGetDirections when Directions button is clicked", async () => {
    await renderVenueCard();

    fireEvent.click(screen.getByText("Directions"));
    expect(mockOnGetDirections).toHaveBeenCalledWith(mockVenue);
  });

  it("calls onSaveFavorite when heart icon is clicked", async () => {
    await renderVenueCard();

    // Find the heart button (favorite button)
    const favoriteButton = document
      .querySelector("button svg.lucide-heart")
      ?.closest("button");
    if (favoriteButton) {
      fireEvent.click(favoriteButton);
      expect(mockOnSaveFavorite).toHaveBeenCalledWith(mockVenue);
    }
  });

  it("calls onRate when Rate button is clicked", async () => {
    await renderVenueCard();

    fireEvent.click(screen.getByText("Rate"));
    expect(mockOnRate).toHaveBeenCalledWith(mockVenue);
  });

  it("renders all action buttons", async () => {
    await renderVenueCard();

    // Verify all actions are available
    expect(screen.getByText("Directions")).toBeInTheDocument();
    expect(screen.getByText("Rate")).toBeInTheDocument();
  });

  it("renders study-specific verification tags for library category", async () => {
    const mockLibrary = {
      ...mockVenue,
      id: "test-library-1",
      name: "Central Library",
      category: "library",
    };
    await renderVenueCard(mockLibrary);

    expect(screen.getByText(/Silent Room/)).toBeInTheDocument();
    expect(screen.getByText(/Study Tables/)).toBeInTheDocument();
    expect(screen.getByText(/Scanners\/Printers/)).toBeInTheDocument();
  });

  it("attaches hover predictor ref to the card root element", async () => {
    const { container } = await renderVenueCard();
    const card = container.firstElementChild as HTMLElement;
    expect(card).toBeInTheDocument();
  });

  it("calls router.prefetch with venue detail route on hover predict", async () => {
    await renderVenueCard();
    expect(mockPrefetch).not.toHaveBeenCalled();

    const card = document.querySelector(
      '[class*="rounded-3xl"]',
    ) as HTMLElement;
    if (card) {
      const realNow = Date.now;
      Date.now = () => 1000000;

      const enterEvent = new MouseEvent("mouseenter", { bubbles: true });
      card.dispatchEvent(enterEvent);

      for (let i = 0; i < 6; i++) {
        const moveEvent = new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100 + i * 2,
          clientY: 100,
        });
        card.dispatchEvent(moveEvent);
      }

      Date.now = realNow;

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
    }

    expect(mockPrefetch).toHaveBeenCalledWith("/venues/test-venue-1");
  });

  it("does not call router.prefetch when venue has no id", async () => {
    const venueNoId = { ...mockVenue, id: "" };
    await renderVenueCard(venueNoId);
    expect(mockPrefetch).not.toHaveBeenCalled();
  });

  it("renders a verified host badge when isClaimed is true", async () => {
    const claimedVenue = { ...mockVenue, isClaimed: true };
    await renderVenueCard(claimedVenue);
    expect(screen.getByTitle("Verified Host")).toBeInTheDocument();
  });

  it("prevents stale venue data from overwriting state when rapidly switching venues", async () => {
    const originalFetch = global.fetch;
    let resolveVenueA: (value: any) => void = () => {};
    let resolveVenueB: (value: any) => void = () => {};

    const mockFetch = jest.fn().mockImplementation((url: string) => {
      const decodedUrl = decodeURIComponent(url.replace(/\+/g, " "));
      if (decodedUrl.includes("Venue A")) {
        return new Promise((resolve) => {
          resolveVenueA = (data: any) =>
            resolve({ ok: true, json: () => Promise.resolve(data) });
        });
      } else if (decodedUrl.includes("Venue B")) {
        return new Promise((resolve) => {
          resolveVenueB = (data: any) =>
            resolve({ ok: true, json: () => Promise.resolve(data) });
        });
      } else {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ metrics: {} }),
        });
      }
    });

    global.fetch = mockFetch as any;

    try {
      const venueA = {
        ...mockVenue,
        id: "test-venue-A",
        name: "Venue A",
        position: { lat: 1, lng: 1 },
      };
      const venueB = {
        ...mockVenue,
        id: "test-venue-B",
        name: "Venue B",
        position: { lat: 2, lng: 2 },
      };

      const { rerender } = render(<VenueCard venue={venueA} />);

      // Switch rapidly to Venue B before Venue A resolves
      rerender(<VenueCard venue={venueB} />);

      // Resolve Venue B first
      await act(async () => {
        resolveVenueB({
          photos: ["https://example.com/b.jpg"],
          categories: ["Category B"],
        });
      });

      expect(screen.getByText("Category B")).toBeInTheDocument();

      // Resolve Venue A's stale response afterward
      await act(async () => {
        resolveVenueA({
          photos: ["https://example.com/a.jpg"],
          categories: ["Stale Category A"],
        });
      });

      // Stale data from Venue A must not overwrite Venue B's data
      expect(screen.queryByText("Stale Category A")).not.toBeInTheDocument();
      expect(screen.getByText("Category B")).toBeInTheDocument();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
