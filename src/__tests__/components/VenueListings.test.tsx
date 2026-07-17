import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueListings } from "@/components/chat/ChatMessages";

const mockVenues = [
  {
    id: "test-venue-1",
    name: "Coffee Shop 1",
    lat: 37.7749,
    lng: -122.4194,
    category: "cafe",
    address: "123 Main St",
    wifi: true,
    hasOutlets: true,
    noiseLevel: "quiet" as const,
    score: 0.85,
  },
  {
    id: "test-venue-2",
    name: "Coworking Hub",
    lat: 37.775,
    lng: -122.4195,
    category: "coworking_space",
    address: "456 Market St",
    wifi: true,
    hasOutlets: true,
    noiseLevel: "moderate" as const,
    score: 0.9,
  },
];

describe("VenueListings Component", () => {
  const mockOnGetDirections = jest.fn();
  const mockOnToggleFavorite = jest.fn();
  const mockOnRateVenue = jest.fn();
  const mockOnOpenDetails = jest.fn();
  const mockOnBook = jest.fn();

  beforeAll(() => {
    // Mock global fetch
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        url: "https://example.com/photo.jpg",
      }),
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderVenueListings = async () => {
    const utils = render(
      <VenueListings
        venues={mockVenues}
        favorites={new Set(["test-venue-2"])}
        onGetDirections={mockOnGetDirections}
        onToggleFavorite={mockOnToggleFavorite}
        onRateVenue={mockOnRateVenue}
        onOpenDetails={mockOnOpenDetails}
        onBook={mockOnBook}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return utils;
  };

  it("renders recommended venues header and default card view", async () => {
    await renderVenueListings();

    expect(screen.getByText("Recommended Venues (2)")).toBeInTheDocument();
    expect(screen.getByText("Coffee Shop 1")).toBeInTheDocument();
    expect(screen.getByText("Coworking Hub")).toBeInTheDocument();

    // Details button is visible on Card view but not in List view
    expect(screen.getAllByText("Details").length).toBeGreaterThan(0);
  });

  it("toggles to list view when list view button is clicked", async () => {
    await renderVenueListings();

    const listBtn = screen.getByLabelText("View as compact list");
    expect(listBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(listBtn);
    });

    // In list view, Details text is not rendered (mini actions replace it)
    expect(screen.queryByText("Details")).not.toBeInTheDocument();

    // WiFi and Power badges are still displayed in list view
    expect(screen.getAllByText("WiFi").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Power").length).toBeGreaterThan(0);
  });
});
