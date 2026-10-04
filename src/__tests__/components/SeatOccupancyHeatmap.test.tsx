import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SeatOccupancyHeatmap } from "@/components/venue/SeatOccupancyHeatmap";

const mockHeatmapData = {
  success: true,
  data: [
    { date: "2026-10-04", hour: 9, occupancy: 25 },
    { date: "2026-10-04", hour: 14, occupancy: 65 },
    { date: "2026-10-04", hour: 18, occupancy: 85 },
  ],
};

const mockForecastData = {
  forecast: Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    predictedOccupancy: i === 14 ? 30 : i === 12 ? 40 : 10,
    confidence: 0.85,
    capacity: 50,
  })),
  recommendedHours: [9, 10, 16],
  capacity: 50,
};

describe("SeatOccupancyHeatmap Component", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/venues/test-venue-123/seating-forecast")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockForecastData,
        });
      }
      if (url.includes("/api/map/forecast-heatmap")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockHeatmapData,
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the 24-hour occupancy forecast timeline graph and scrubber", async () => {
    render(<SeatOccupancyHeatmap venueId="test-venue-123" />);

    await waitFor(() => {
      expect(screen.getByTestId("seat-occupancy-heatmap")).toBeInTheDocument();
    });

    expect(screen.getByText(/Seat occupancy forecast/i)).toBeInTheDocument();
    expect(screen.getByTestId("timeline-scrubber-slider")).toBeInTheDocument();
    expect(screen.getByTestId("occupancy-confidence-insight")).toBeInTheDocument();
  });

  it("updates confidence intervals and fires onSelectSlot when scrubbing slider", async () => {
    const onSelectSlot = jest.fn();
    render(
      <SeatOccupancyHeatmap
        venueId="test-venue-123"
        onSelectSlot={onSelectSlot}
        selectedDate="2026-10-04"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("timeline-scrubber-slider")).toBeInTheDocument();
    });

    const slider = screen.getByTestId("timeline-scrubber-slider");
    fireEvent.change(slider, { target: { value: "14" } });

    expect(onSelectSlot).toHaveBeenCalledWith({
      date: "2026-10-04",
      time: "14:00",
    });

    const insight = screen.getByTestId("occupancy-confidence-insight");
    expect(insight.textContent).toMatch(/Usually/i);
    expect(insight.textContent).toMatch(/2:00 PM/i);
  });

  it("updates selected hour when clicking on a timeline histogram bar", async () => {
    const onSelectSlot = jest.fn();
    render(
      <SeatOccupancyHeatmap
        venueId="test-venue-123"
        onSelectSlot={onSelectSlot}
        selectedDate="2026-10-04"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Quiet Hours:")).toBeInTheDocument();
    });

    const quietHourButton = screen.getByRole("button", { name: "9:00 AM" });
    fireEvent.click(quietHourButton);

    expect(onSelectSlot).toHaveBeenCalledWith({
      date: "2026-10-04",
      time: "09:00",
    });
  });
});
