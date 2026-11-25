import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  VenueNoiseForecast,
  classifyNoise,
  getNoiseColor,
} from "@/components/venue/VenueNoiseForecast";

// Helper mock data generating 24 hours of forecast
function createMockForecastResponse(overrides: Partial<any> = {}) {
  const forecast = Array.from({ length: 24 }, (_, i) => {
    // 08:00 (45dB - quiet), 14:00 (60dB - moderate), 20:00 (72dB - loud)
    let predictedDb: number | null = 45;
    if (i >= 9 && i <= 17) {
      predictedDb = 60; // moderate
    } else if (i >= 18 && i <= 22) {
      predictedDb = 72; // loud
    }
    return {
      hour: i,
      predictedDb,
      confidence: 0.85,
      samples: i < 12 ? 10 : 0, // past hours have samples
    };
  });

  return {
    venueId: "test-venue-123",
    forecast: {
      forecast,
      recommendedHours: [7, 8, 23],
    },
    ...overrides,
  };
}

describe("classifyNoise and getNoiseColor", () => {
  it("classifies noise levels correctly according to thresholds", () => {
    expect(classifyNoise(null)).toBe("No Data");
    expect(classifyNoise(NaN)).toBe("No Data");
    expect(classifyNoise(45)).toBe("Quiet");
    expect(classifyNoise(49.9)).toBe("Quiet");
    expect(classifyNoise(50)).toBe("Moderate");
    expect(classifyNoise(65)).toBe("Moderate");
    expect(classifyNoise(65.1)).toBe("Loud");
    expect(classifyNoise(80)).toBe("Loud");
  });

  it("returns correct color tokens for classifications", () => {
    expect(getNoiseColor("Quiet").fillHex).toBe("#10b981"); // Emerald
    expect(getNoiseColor("Moderate").fillHex).toBe("#f59e0b"); // Amber
    expect(getNoiseColor("Loud").fillHex).toBe("#f43f5e"); // Rose
    expect(getNoiseColor("No Data").fillHex).toBe("#71717a"); // Muted Zinc
  });
});

describe("VenueNoiseForecast Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders loading state initially while fetching", () => {
    // Keep promise pending
    global.fetch = jest.fn(() => new Promise(() => {}));

    render(<VenueNoiseForecast venueId="test-venue-123" />);

    expect(screen.getByTestId("venue-noise-forecast-loading")).toBeInTheDocument();
    expect(screen.getByText(/Loading 24-hour noise forecast/i)).toBeInTheDocument();
  });

  it("renders API error state on network or status failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(<VenueNoiseForecast venueId="test-venue-123" />);

    await waitFor(() => {
      expect(screen.getByTestId("venue-noise-forecast-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/Forecast Unavailable/i)).toBeInTheDocument();
  });

  it("renders empty telemetry state when no sound readings exist", async () => {
    const emptyResponse = {
      venueId: "test-venue-123",
      forecast: {
        forecast: Array.from({ length: 24 }, (_, i) => ({
          hour: i,
          predictedDb: null,
          confidence: 0,
          samples: 0,
        })),
        recommendedHours: [],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => emptyResponse,
    });

    render(<VenueNoiseForecast venueId="test-venue-123" venueName="Quiet Library" />);

    await waitFor(() => {
      expect(screen.getByTestId("venue-noise-forecast-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/No Historical Telemetry/i)).toBeInTheDocument();
    expect(screen.getByText(/Quiet Library/i)).toBeInTheDocument();
  });

  it("renders all 24 hourly bar slots and binds data correctly", async () => {
    const mockData = createMockForecastResponse();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    render(<VenueNoiseForecast venueId="test-venue-123" venueName="Test Venue" />);

    await waitFor(() => {
      expect(screen.getByTestId("venue-noise-forecast")).toBeInTheDocument();
    });

    // Check all 24 hourly bar elements exist
    for (let h = 0; h < 24; h++) {
      const bar = screen.getByTestId(`noise-bar-${h}`);
      expect(bar).toBeInTheDocument();
    }

    // Check SVG figure role and accessible label
    const chart = screen.getByRole("figure", {
      name: /24-hour ambient noise decibel forecast chart/i,
    });
    expect(chart).toBeInTheDocument();
  });

  it("handles partial telemetry correctly without crashing", async () => {
    // Only a few hours have data
    const partialData = {
      venueId: "partial-venue",
      forecast: {
        forecast: [
          { hour: 10, predictedDb: 55, confidence: 0.9, samples: 4 },
          { hour: 11, predictedDb: 70, confidence: 0.95, samples: 6 },
        ],
        recommendedHours: [10],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => partialData,
    });

    render(<VenueNoiseForecast venueId="partial-venue" />);

    await waitFor(() => {
      expect(screen.getByTestId("venue-noise-forecast")).toBeInTheDocument();
    });

    // Slot 10 has data
    const bar10 = screen.getByTestId("noise-bar-10");
    expect(bar10).toHaveAttribute("aria-label", expect.stringContaining("55 dB SPL"));

    // Slot 0 has no data fallback
    const bar0 = screen.getByTestId("noise-bar-0");
    expect(bar0).toHaveAttribute("aria-label", expect.stringContaining("No data"));
  });

  it("renders the current-time indicator line accurately", async () => {
    const mockData = createMockForecastResponse();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    render(<VenueNoiseForecast venueId="test-venue-123" />);

    await waitFor(() => {
      expect(screen.getByTestId("current-time-indicator")).toBeInTheDocument();
    });

    const indicator = screen.getByTestId("current-time-indicator");
    expect(indicator.querySelector("line")).toHaveAttribute("stroke", "#ef4444");
  });

  it("displays Quiet Hours banner when venue has configured quietHoursStart and quietHoursEnd", async () => {
    const mockData = createMockForecastResponse();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    render(
      <VenueNoiseForecast
        venueId="test-venue-123"
        quietHoursStart="09:00"
        quietHoursEnd="12:00"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("quiet-hours-banner")).toBeInTheDocument();
    });

    expect(screen.getByText("09:00 – 12:00")).toBeInTheDocument();
  });

  it("displays Quiet Hours banner using API recommendedHours when explicit quiet hours are omitted", async () => {
    const mockData = createMockForecastResponse({
      forecast: {
        forecast: Array.from({ length: 24 }, (_, i) => ({
          hour: i,
          predictedDb: 40,
          confidence: 0.8,
          samples: 5,
        })),
        recommendedHours: [8, 9],
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    render(<VenueNoiseForecast venueId="test-venue-123" />);

    await waitFor(() => {
      expect(screen.getByTestId("quiet-hours-banner")).toBeInTheDocument();
    });

    expect(screen.getByText("08:00, 09:00")).toBeInTheDocument();
  });

  it("hides Quiet Hours banner when neither explicit quiet hours nor recommendedHours are present", async () => {
    const mockData = createMockForecastResponse({
      forecast: {
        forecast: Array.from({ length: 24 }, (_, i) => ({
          hour: i,
          predictedDb: 55,
          confidence: 0.8,
          samples: 5,
        })),
        recommendedHours: [],
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    render(
      <VenueNoiseForecast
        venueId="test-venue-123"
        quietHoursStart={null}
        quietHoursEnd={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("venue-noise-forecast")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("quiet-hours-banner")).not.toBeInTheDocument();
  });

  it("updates tooltip and focus state on mouse hover and keyboard navigation", async () => {
    const mockData = createMockForecastResponse();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    render(<VenueNoiseForecast venueId="test-venue-123" />);

    await waitFor(() => {
      expect(screen.getByTestId("venue-noise-forecast")).toBeInTheDocument();
    });

    const bar8 = screen.getByTestId("noise-bar-8");

    // Mouse hover
    fireEvent.mouseEnter(bar8);
    const tooltip = screen.getByTestId("noise-forecast-tooltip");
    expect(tooltip).toHaveTextContent("08:00 - 09:00");
    expect(tooltip).toHaveTextContent("Quiet");
    expect(tooltip).toHaveTextContent("45 dB SPL");

    // Mouse leave
    fireEvent.mouseLeave(bar8);

    // Keyboard focus & Arrow Navigation
    fireEvent.focus(bar8);
    expect(tooltip).toHaveTextContent("08:00 - 09:00");

    fireEvent.keyDown(bar8, { key: "ArrowRight" });
    expect(tooltip).toHaveTextContent("09:00 - 10:00");
  });

  it("renders legend with quiet, moderate, loud, historical, and predicted labels", async () => {
    const mockData = createMockForecastResponse();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    render(<VenueNoiseForecast venueId="test-venue-123" />);

    await waitFor(() => {
      expect(screen.getByTestId("noise-forecast-legend")).toBeInTheDocument();
    });

    const legend = screen.getByTestId("noise-forecast-legend");
    expect(legend).toHaveTextContent("Quiet (<50 dB)");
    expect(legend).toHaveTextContent("Moderate (50–65 dB)");
    expect(legend).toHaveTextContent("Loud (>65 dB)");
    expect(legend).toHaveTextContent("Historical");
    expect(legend).toHaveTextContent("Predicted");
    expect(legend).toHaveTextContent("Current Time");
  });
});
