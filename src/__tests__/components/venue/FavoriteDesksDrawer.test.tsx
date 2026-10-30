import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  FavoriteDesksDrawer,
  type FavoriteItemWithStatus,
} from "@/components/venue/FavoriteDesksDrawer";

const mockFavorites: FavoriteItemWithStatus[] = [
  {
    id: "fav-1",
    userId: "user-1",
    venueId: "venue-sf-01",
    deskId: "desk-101",
    deskLabel: "Window Alpha",
    deskType: "standing",
    price: 25,
    tags: ["natural_light", "quiet"],
    isFreeAlertActive: false,
    createdAt: new Date().toISOString(),
    availability: {
      deskId: "desk-101",
      isFree: true,
      lastCheckedAt: new Date().toISOString(),
    },
  },
  {
    id: "fav-2",
    userId: "user-1",
    venueId: "venue-sf-01",
    deskId: "desk-102",
    deskLabel: "Corner Pod",
    deskType: "ergonomic",
    price: 30,
    tags: ["dual_monitor", "power_strip"],
    isFreeAlertActive: true,
    createdAt: new Date().toISOString(),
    availability: {
      deskId: "desk-102",
      isFree: false,
      lastCheckedAt: new Date().toISOString(),
    },
  },
];

describe("FavoriteDesksDrawer Component", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("returns null when favorites list is empty", () => {
    const { container } = render(
      <FavoriteDesksDrawer venueId="venue-sf-01" initialFavorites={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders desk cards, counts, and status indicators accurately", () => {
    render(
      <FavoriteDesksDrawer
        venueId="venue-sf-01"
        venueName="SoHo Loft"
        initialFavorites={mockFavorites}
      />
    );

    expect(screen.getByTestId("favorite-desks-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("favorite-desks-header-title")).toHaveTextContent(
      "SoHo Loft — Saved Desks"
    );
    expect(screen.getByTestId("favorite-desks-count-badge")).toHaveTextContent(
      "2 saved"
    );

    // Desk 101: Free Now
    expect(screen.getByTestId("favorite-desk-card-desk-101")).toBeInTheDocument();
    expect(screen.getByTestId("favorite-desk-status-desk-101")).toHaveTextContent(
      "Free Now"
    );
    expect(screen.getByTestId("favorite-desk-reserve-desk-101")).toBeInTheDocument();

    // Desk 102: Occupied with Alert On
    expect(screen.getByTestId("favorite-desk-card-desk-102")).toBeInTheDocument();
    expect(screen.getByTestId("favorite-desk-status-desk-102")).toHaveTextContent(
      "Occupied"
    );
    expect(screen.getByTestId("favorite-desk-toggle-alert-desk-102")).toHaveTextContent(
      "Alert On"
    );
    expect(screen.getByTestId("favorite-desk-test-alert-desk-102")).toBeInTheDocument();
  });

  it("fetches favorites when initialFavorites is not passed", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, favorites: mockFavorites }),
    });

    await act(async () => {
      render(<FavoriteDesksDrawer venueId="venue-sf-01" />);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/venues/venue-sf-01/desks/favorites");
      expect(screen.getByTestId("favorite-desks-drawer")).toBeInTheDocument();
    });
  });

  it("triggers onSelectDesk when Reserve button is clicked", () => {
    const handleSelectDesk = jest.fn();
    render(
      <FavoriteDesksDrawer
        venueId="venue-sf-01"
        initialFavorites={mockFavorites}
        onSelectDesk={handleSelectDesk}
      />
    );

    const reserveBtn = screen.getByTestId("favorite-desk-reserve-desk-101");
    fireEvent.click(reserveBtn);
    expect(handleSelectDesk).toHaveBeenCalledWith("desk-101");
  });

  it("toggles alert via POST API call", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(
      <FavoriteDesksDrawer
        venueId="venue-sf-01"
        initialFavorites={mockFavorites}
      />
    );

    const alertBtn = screen.getByTestId("favorite-desk-toggle-alert-desk-101");
    expect(alertBtn).toHaveTextContent("Notify When Free");

    await act(async () => {
      fireEvent.click(alertBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/venues/venue-sf-01/desks/favorites",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "alert",
          venueId: "venue-sf-01",
          deskId: "desk-101",
          deskLabel: "Window Alpha",
          deskType: "standing",
          price: 25,
          tags: ["natural_light", "quiet"],
          active: true,
        }),
      })
    );

    expect(screen.getByTestId("favorite-desk-toggle-alert-desk-101")).toHaveTextContent(
      "Alert On"
    );
  });

  it("simulates desk vacancy alert banner and dismisses on click or timeout", () => {
    render(
      <FavoriteDesksDrawer
        venueId="venue-sf-01"
        initialFavorites={mockFavorites}
      />
    );

    const testAlertBtn = screen.getByTestId("favorite-desk-test-alert-desk-102");
    fireEvent.click(testAlertBtn);

    const banner = screen.getByTestId("favorite-desks-notification-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId("favorite-desks-notification-text")).toHaveTextContent(
      'Your favorite desk "Corner Pod" is now FREE!'
    );

    // Test dismiss button
    const dismissBtn = screen.getByTestId("favorite-desks-notification-dismiss");
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId("favorite-desks-notification-banner")).toBeNull();

    // Trigger again to test auto-dismiss timeout
    fireEvent.click(testAlertBtn);
    expect(screen.getByTestId("favorite-desks-notification-banner")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(6000);
    });

    expect(screen.queryByTestId("favorite-desks-notification-banner")).toBeNull();
  });

  it("applies custom className cleanly", () => {
    render(
      <FavoriteDesksDrawer
        venueId="venue-sf-01"
        initialFavorites={mockFavorites}
        className="custom-desks-drawer-style"
      />
    );

    expect(screen.getByTestId("favorite-desks-drawer").className).toContain(
      "custom-desks-drawer-style"
    );
  });
});
