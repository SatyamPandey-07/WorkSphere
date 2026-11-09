import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ComparisonTool } from "@/components/collections/ComparisonTool";
import type { Venue } from "@/types/venue";

// Mock MetricsWidget so it doesn't do complex external calls
jest.mock("@/components/collections/MetricsWidget", () => ({
  MetricsWidget: ({ title }: { title: string }) => (
    <div data-testid="metrics-widget">{title}</div>
  ),
}));

describe("ComparisonTool Column Reordering & Accessibility", () => {
  const originalFetch = global.fetch;

  const mockVenues: Venue[] = [
    {
      id: "venue-1",
      name: "Apex Cowork",
      address: "100 Market St",
      category: "coworking",
      lat: 37.7749,
      lng: -122.4194,
      score: 4.8,
      rating: 4.8,
      reviewCount: 42,
      wifiSpeed: 150,
      noiseLevel: "quiet",
      hasOutlets: true,
      outletDensity: "abundant",
    },
    {
      id: "venue-2",
      name: "Beacon Workspace",
      address: "200 Mission St",
      category: "cafe",
      lat: 37.7849,
      lng: -122.4094,
      score: 4.5,
      rating: 4.5,
      reviewCount: 18,
      wifiSpeed: 80,
      noiseLevel: "moderate",
      hasOutlets: true,
      outletDensity: "moderate",
    },
    {
      id: "venue-3",
      name: "Central Commons",
      address: "300 Howard St",
      category: "library",
      lat: 37.7949,
      lng: -122.3994,
      score: 4.2,
      rating: 4.2,
      wifiSpeed: 50,
      noiseLevel: "silent",
      hasOutlets: false,
    },
  ];

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ folders: [] }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("renders side-by-side venue comparison table with headers and feature rows", () => {
    render(<ComparisonTool venues={mockVenues} />);

    expect(screen.getByTestId("venue-comparison-section")).toBeInTheDocument();
    expect(screen.getByText("Apex Cowork")).toBeInTheDocument();
    expect(screen.getByText("Beacon Workspace")).toBeInTheDocument();
    expect(screen.getByText("Central Commons")).toBeInTheDocument();

    expect(screen.getByText("Rating")).toBeInTheDocument();
    expect(screen.getByText("WiFi")).toBeInTheDocument();
    expect(screen.getByText("Noise Level")).toBeInTheDocument();
    expect(screen.getByText("Power Outlets")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
  });

  it("disables Move Left on first column and Move Right on last column", () => {
    render(<ComparisonTool venues={mockVenues} />);

    const firstMoveLeft = screen.getByTestId("move-left-venue-1");
    const firstMoveRight = screen.getByTestId("move-right-venue-1");
    expect(firstMoveLeft).toBeDisabled();
    expect(firstMoveRight).not.toBeDisabled();

    const lastMoveLeft = screen.getByTestId("move-left-venue-3");
    const lastMoveRight = screen.getByTestId("move-right-venue-3");
    expect(lastMoveLeft).not.toBeDisabled();
    expect(lastMoveRight).toBeDisabled();
  });

  it("reorders columns using Move Right and Move Left buttons and invokes onOrderChange", () => {
    const handleOrderChange = jest.fn();
    render(
      <ComparisonTool venues={mockVenues} onOrderChange={handleOrderChange} />,
    );

    // Initial order: venue-1, venue-2, venue-3
    const moveRightFirst = screen.getByTestId("move-right-venue-1");
    fireEvent.click(moveRightFirst);

    // After move right: venue-2, venue-1, venue-3
    expect(handleOrderChange).toHaveBeenCalledTimes(1);
    expect(handleOrderChange).toHaveBeenCalledWith([
      mockVenues[1],
      mockVenues[0],
      mockVenues[2],
    ]);

    // Live announcement updated
    const liveAnnouncement = screen.getByTestId("comparison-live-announcement");
    expect(liveAnnouncement).toHaveTextContent(
      "Moved Apex Cowork right to position 2 of 3.",
    );

    // Now move venue-1 right again
    const moveRightAgain = screen.getByTestId("move-right-venue-1");
    fireEvent.click(moveRightAgain);

    // Order: venue-2, venue-3, venue-1
    expect(handleOrderChange).toHaveBeenCalledWith([
      mockVenues[1],
      mockVenues[2],
      mockVenues[0],
    ]);
    expect(liveAnnouncement).toHaveTextContent(
      "Moved Apex Cowork right to position 3 of 3.",
    );

    // Now move venue-1 left
    const moveLeftVenue1 = screen.getByTestId("move-left-venue-1");
    fireEvent.click(moveLeftVenue1);

    // Order: venue-2, venue-1, venue-3
    expect(handleOrderChange).toHaveBeenCalledWith([
      mockVenues[1],
      mockVenues[0],
      mockVenues[2],
    ]);
    expect(liveAnnouncement).toHaveTextContent(
      "Moved Apex Cowork left to position 2 of 3.",
    );
  });

  it("reorders columns using keyboard Arrow keys on drag handles", () => {
    const handleOrderChange = jest.fn();
    render(
      <ComparisonTool venues={mockVenues} onOrderChange={handleOrderChange} />,
    );

    const dragHandle1 = screen.getByTestId("drag-handle-venue-1");

    // Press ArrowRight on venue-1
    fireEvent.keyDown(dragHandle1, { key: "ArrowRight" });

    expect(handleOrderChange).toHaveBeenCalledWith([
      mockVenues[1],
      mockVenues[0],
      mockVenues[2],
    ]);
    expect(
      screen.getByTestId("comparison-live-announcement"),
    ).toHaveTextContent("Moved Apex Cowork right to position 2 of 3.");

    // Press ArrowLeft on venue-1 (now at index 1)
    const dragHandle1Updated = screen.getByTestId("drag-handle-venue-1");
    fireEvent.keyDown(dragHandle1Updated, { key: "ArrowLeft" });

    expect(handleOrderChange).toHaveBeenCalledWith([
      mockVenues[0],
      mockVenues[1],
      mockVenues[2],
    ]);
    expect(
      screen.getByTestId("comparison-live-announcement"),
    ).toHaveTextContent("Moved Apex Cowork left to position 1 of 3.");
  });

  it("reorders columns using drag and drop handlers", () => {
    const handleOrderChange = jest.fn();
    render(
      <ComparisonTool venues={mockVenues} onOrderChange={handleOrderChange} />,
    );

    const dragHandle = screen.getByTestId("drag-handle-venue-1");
    const targetColumn = screen.getByTestId("venue-column-venue-3");

    const mockDataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      data: {} as Record<string, string>,
      setData(format: string, data: string) {
        this.data[format] = data;
      },
      getData(format: string) {
        return this.data[format] || "";
      },
    };

    fireEvent.dragStart(dragHandle, { dataTransfer: mockDataTransfer });
    fireEvent.dragOver(targetColumn, { dataTransfer: mockDataTransfer });
    fireEvent.drop(targetColumn, { dataTransfer: mockDataTransfer });

    expect(handleOrderChange).toHaveBeenCalledWith([
      mockVenues[1],
      mockVenues[2],
      mockVenues[0],
    ]);

    expect(
      screen.getByTestId("comparison-live-announcement"),
    ).toHaveTextContent("Moved Apex Cowork to position 3 of 3.");
  });

  it("extracts venues from currentFolder and renders folder comparison", async () => {
    const folder = {
      id: "folder-1",
      name: "Favorites",
      venues: [{ venue: mockVenues[0] }, { venue: mockVenues[1] }],
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        folders: [{ id: "folder-2", name: "Workspaces" }],
      }),
    });

    render(<ComparisonTool currentFolder={folder} />);

    expect(screen.getByText("Apex Cowork")).toBeInTheDocument();
    expect(screen.getByText("Beacon Workspace")).toBeInTheDocument();
    expect(screen.getByText("Compare Collections")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Workspaces")).toBeInTheDocument();
    });
  });
});
