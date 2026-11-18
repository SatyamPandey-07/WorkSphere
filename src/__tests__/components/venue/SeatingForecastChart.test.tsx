import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SeatingForecastChartDefault, {
  SeatingForecastChart,
} from "@/components/venue/SeatingForecastChart";

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-area-chart">{children}</div>
  ),
  Area: () => <div data-testid="mock-area" />,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="mock-bar" />,
  Cell: () => <div data-testid="mock-cell" />,
  XAxis: () => <div data-testid="mock-xaxis" />,
  YAxis: () => <div data-testid="mock-yaxis" />,
  CartesianGrid: () => <div data-testid="mock-cartesian-grid" />,
  Tooltip: () => <div data-testid="mock-tooltip" />,
  ReferenceArea: () => <div data-testid="mock-reference-area" />,
}));

const mockForecastData = {
  capacity: 40,
  recommendedHours: [9, 10, 14],
  forecast: [
    { hour: 8, predictedOccupancy: 5, confidence: 0.85, capacity: 40 },
    { hour: 9, predictedOccupancy: 8, confidence: 0.9, capacity: 40 },
    { hour: 10, predictedOccupancy: 12, confidence: 0.92, capacity: 40 },
    { hour: 11, predictedOccupancy: 25, confidence: 0.88, capacity: 40 },
    { hour: 12, predictedOccupancy: 34, confidence: 0.89, capacity: 40 },
    { hour: 13, predictedOccupancy: 36, confidence: 0.87, capacity: 40 },
    { hour: 14, predictedOccupancy: 15, confidence: 0.85, capacity: 40 },
  ],
};

describe("SeatingForecastChart Component Suite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockForecastData,
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("exports default matching named export", () => {
    expect(SeatingForecastChartDefault).toBe(SeatingForecastChart);
  });

  it("renders loading indicator initially", () => {
    render(<SeatingForecastChart venueId="v-101" />);

    expect(screen.getByTestId("seating-forecast-loading")).toBeInTheDocument();
  });

  it("renders unavailable message when fetch fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(<SeatingForecastChart venueId="v-101" />);

    await waitFor(() => {
      expect(screen.getByTestId("seating-forecast-unavailable")).toBeInTheDocument();
      expect(screen.getByText("Forecast unavailable.")).toBeInTheDocument();
    });
  });

  it("renders empty state when all predictedOccupancy points are null", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        capacity: 40,
        recommendedHours: [],
        forecast: [
          { hour: 8, predictedOccupancy: null, confidence: 0, capacity: 40 },
          { hour: 9, predictedOccupancy: null, confidence: 0, capacity: 40 },
        ],
      }),
    });

    render(<SeatingForecastChart venueId="v-empty" />);

    await waitFor(() => {
      expect(screen.getByTestId("seating-forecast-empty")).toBeInTheDocument();
      expect(
        screen.getByText(/no historical data to generate forecast/i)
      ).toBeInTheDocument();
    });
  });

  it("renders recommended hours and chart with valid forecast data", async () => {
    render(<SeatingForecastChart venueId="v-101" />);

    await waitFor(() => {
      expect(screen.getByTestId("seating-forecast-chart")).toBeInTheDocument();
      expect(screen.getByText(/recommended seating times:/i)).toBeInTheDocument();
      expect(screen.getByText("09:00")).toBeInTheDocument();
      expect(screen.getByText("10:00")).toBeInTheDocument();
      expect(screen.getByText("14:00")).toBeInTheDocument();
      expect(screen.getByTestId("day-by-day-forecast-btn")).toBeInTheDocument();
      expect(screen.getByTestId("mock-area-chart")).toBeInTheDocument();
    });
  });

  it("opens day-by-day forecast modal and displays 7-day breakdown", async () => {
    render(<SeatingForecastChart venueId="v-101" />);

    const openBtn = await screen.findByTestId("day-by-day-forecast-btn");
    fireEvent.click(openBtn);

    expect(screen.getByTestId("seating-forecast-modal")).toBeInTheDocument();
    expect(
      screen.getByText("7-Day Seating Occupancy Forecast")
    ).toBeInTheDocument();
    expect(screen.getByText("Monday")).toBeInTheDocument();
    expect(screen.getByText("Tuesday")).toBeInTheDocument();
  });

  it("interacts with day breakdown cards inside modal to select a day", async () => {
    render(<SeatingForecastChart venueId="v-101" />);

    const openBtn = await screen.findByTestId("day-by-day-forecast-btn");
    fireEvent.click(openBtn);

    const mondayCard = screen.getByText("Monday").closest("div");
    expect(mondayCard).toBeInTheDocument();
    if (mondayCard) {
      fireEvent.click(mondayCard);
    }

    expect(screen.getByTestId("seating-forecast-modal")).toBeInTheDocument();
  });

  it("closes modal via footer close button", async () => {
    render(<SeatingForecastChart venueId="v-101" />);

    const openBtn = await screen.findByTestId("day-by-day-forecast-btn");
    fireEvent.click(openBtn);

    expect(screen.getByTestId("seating-forecast-modal")).toBeInTheDocument();

    const footerClose = screen.getByTestId("seating-forecast-modal-footer-close-btn");
    fireEvent.click(footerClose);

    expect(screen.queryByTestId("seating-forecast-modal")).not.toBeInTheDocument();
  });

  it("closes modal on Escape key press", async () => {
    render(<SeatingForecastChart venueId="v-101" />);

    const openBtn = await screen.findByTestId("day-by-day-forecast-btn");
    fireEvent.click(openBtn);

    expect(screen.getByTestId("seating-forecast-modal")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("seating-forecast-modal")).not.toBeInTheDocument();
  });

  it("applies custom className and custom data-testid", async () => {
    render(
      <SeatingForecastChart
        venueId="v-101"
        className="custom-forecast-class"
        data-testid="custom-forecast-chart"
      />
    );

    await waitFor(() => {
      const container = screen.getByTestId("custom-forecast-chart");
      expect(container).toBeInTheDocument();
      expect(container).toHaveClass("custom-forecast-class");
    });
  });
});
