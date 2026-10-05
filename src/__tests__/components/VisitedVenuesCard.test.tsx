import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VisitedVenuesCard } from "@/components/profile/VisitedVenuesCard";

describe("VisitedVenuesCard", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("renders loading state initially", () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
    render(<VisitedVenuesCard />);
    expect(screen.getByTestId("visited-venues-loading")).toBeInTheDocument();
  });

  it("renders empty state when user has 0 visited venues", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response);

    render(<VisitedVenuesCard />);

    await waitFor(() => {
      expect(screen.getByTestId("visited-venues-empty")).toBeInTheDocument();
    });

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(
      screen.getByText(/You haven't visited any workspaces yet/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("visited-venues-badge"),
    ).not.toBeInTheDocument();
  });

  it("calculates distinct venues and displays the count and badge", async () => {
    const mockBookings = [
      { id: "b1", venueId: "v1", venue: { id: "v1", name: "WeWork Central" } },
      { id: "b2", venueId: "v2", venue: { id: "v2", name: "Spaces Downtown" } },
      { id: "b3", venueId: "v1", venue: { id: "v1", name: "WeWork Central" } }, // duplicate venue
    ];

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockBookings }),
    } as Response);

    render(<VisitedVenuesCard />);

    await waitFor(() => {
      expect(screen.getByTestId("visited-venues-count")).toBeInTheDocument();
    });

    expect(screen.getByTestId("visited-venues-count")).toHaveTextContent("2");
    expect(screen.getByText("unique venues")).toBeInTheDocument();
    expect(screen.getByTestId("visited-venues-badge")).toHaveTextContent(
      "Active Explorer",
    );
    expect(screen.getByText("WeWork Central")).toBeInTheDocument();
    expect(screen.getByText("Spaces Downtown")).toBeInTheDocument();
  });

  it("handles fetch error gracefully", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("Network error"));

    render(<VisitedVenuesCard />);

    await waitFor(() => {
      expect(
        screen.getByText("Unable to load visited venues statistics"),
      ).toBeInTheDocument();
    });
  });
});
