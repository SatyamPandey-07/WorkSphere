import { render, screen, waitFor } from "@testing-library/react";
import { SeatingForecastChart } from "@/components/venue/SeatingForecastChart";

// Mock the global fetch
global.fetch = jest.fn();

describe("SeatingForecastChart", () => {
  const mockVenueId = "v123";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a loading state initially", () => {
    // Return a promise that doesn't resolve immediately
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      <SeatingForecastChart venueId={mockVenueId} />,
    );
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("renders an error message when the fetch fails", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("API Down"));

    render(<SeatingForecastChart venueId={mockVenueId} />);

    await waitFor(() => {
      expect(screen.getByText("Forecast unavailable.")).toBeInTheDocument();
    });
  });

  it("renders the chart when data is loaded successfully", async () => {
    const mockData = {
      capacity: 50,
      recommendedHours: [10, 11, 14],
      forecast: [
        { hour: 9, predictedOccupancy: 20, confidence: 0.9, capacity: 50 },
        { hour: 10, predictedOccupancy: 15, confidence: 0.8, capacity: 50 },
      ],
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    render(<SeatingForecastChart venueId={mockVenueId} />);

    await waitFor(() => {
      expect(
        screen.getByText("Recommended Seating Times:"),
      ).toBeInTheDocument();
      expect(screen.getByText("10:00")).toBeInTheDocument();
      expect(screen.getByText("Predicted Occupancy")).toBeInTheDocument();
      expect(screen.getByText("Most Available Hours")).toBeInTheDocument();
    });
  });

  it("renders an empty state when no historical data is present", async () => {
    const mockData = {
      capacity: 50,
      recommendedHours: [],
      forecast: [
        { hour: 9, predictedOccupancy: null, confidence: 0, capacity: 50 },
      ],
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    render(<SeatingForecastChart venueId={mockVenueId} />);

    await waitFor(() => {
      expect(
        screen.getByText("No historical data to generate forecast."),
      ).toBeInTheDocument();
    });
  });
});
