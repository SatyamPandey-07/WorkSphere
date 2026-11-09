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

  describe("Real-time Seat Availability aria-live Announcements", () => {
    it("renders the visually-hidden aria-live announcer region with role status and polite live attribute", async () => {
      render(<SeatOccupancyHeatmap venueId="test-venue-123" />);

      await waitFor(() => {
        expect(screen.getByTestId("seat-availability-announcer")).toBeInTheDocument();
      });

      const announcer = screen.getByTestId("seat-availability-announcer");
      expect(announcer).toHaveAttribute("role", "status");
      expect(announcer).toHaveAttribute("aria-live", "polite");
      expect(announcer).toHaveAttribute("aria-atomic", "true");
      expect(announcer).toHaveClass("sr-only");
    });

    it("announces when a seat becomes available or reserved after status transitions", async () => {
      const initialSeats = [
        { seatNumber: "4B", available: false },
        { seatNumber: "12A", available: true },
      ];

      const { rerender } = render(
        <SeatOccupancyHeatmap
          venueId="test-venue-123"
          seats={initialSeats}
          announcementThrottleMs={50}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("seat-availability-announcer")).toBeInTheDocument();
      });

      // Initially on mount, announcer is silent to avoid spamming existing state
      expect(screen.getByTestId("seat-availability-announcer").textContent).toBe("");

      // Seat 4B becomes available (false -> true)
      const updatedSeats = [
        { seatNumber: "4B", available: true },
        { seatNumber: "12A", available: true },
      ];

      rerender(
        <SeatOccupancyHeatmap
          venueId="test-venue-123"
          seats={updatedSeats}
          announcementThrottleMs={50}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("seat-availability-announcer").textContent).toBe(
          "Seat 4B is now available",
        );
      });

      // Seat 12A is reserved (true -> false)
      const secondUpdate = [
        { seatNumber: "4B", available: true },
        { seatNumber: "12A", available: false },
      ];

      rerender(
        <SeatOccupancyHeatmap
          venueId="test-venue-123"
          seats={secondUpdate}
          announcementThrottleMs={50}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("seat-availability-announcer").textContent).toBe(
          "Seat 12A was just reserved",
        );
      });
    });

    it("throttles and joins batch seat transitions to prevent assistive device spamming", async () => {
      const initialSeats = [
        { seatNumber: "1A", available: false },
        { seatNumber: "2B", available: true },
      ];

      const { rerender } = render(
        <SeatOccupancyHeatmap
          venueId="test-venue-123"
          seats={initialSeats}
          announcementThrottleMs={50}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("seat-availability-announcer")).toBeInTheDocument();
      });

      // Multiple simultaneous seat changes
      const batchUpdate = [
        { seatNumber: "1A", available: true },
        { seatNumber: "2B", available: false },
      ];

      rerender(
        <SeatOccupancyHeatmap
          venueId="test-venue-123"
          seats={batchUpdate}
          announcementThrottleMs={50}
        />,
      );

      await waitFor(() => {
        const text = screen.getByTestId("seat-availability-announcer").textContent;
        expect(text).toContain("Seat 1A is now available");
        expect(text).toContain("Seat 2B was just reserved");
      });
    });
  });
});

