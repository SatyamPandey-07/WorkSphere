import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultEdgeAcousticForecaster, {
  EdgeAcousticForecaster,
  type EdgeAcousticForecasterProps,
} from "@/components/noise/EdgeAcousticForecaster";
import type { VenueNoiseForecastReport } from "@/lib/noise/acousticForecaster";

const mockReport: VenueNoiseForecastReport = {
  venueId: "venue-blr-01",
  venueName: "Koramangala Tech Hub",
  venueCategory: "coworking",
  currentClassification: {
    decibelsDb: 39,
    dominantCategory: "SILENT_FOCUS",
    suitability: "EXCELLENT_CALL_READY",
    spectralBands: {
      lowFreqRumblePct: 15,
      speechBandPct: 20,
      highFreqClatterPct: 10,
    },
    signalToNoiseRatioDb: 18,
    recommendation: "Ideal for high-stakes video conferences and presentations.",
  },
  hourlyForecast: Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    timeLabel: `${i.toString().padStart(2, "0")}:00`,
    predictedDecibelsDb: i >= 8 && i <= 18 ? 48 : 36,
    p90PeakDecibelsDb: i >= 8 && i <= 18 ? 55 : 40,
    suitability: i >= 8 && i <= 18 ? "MODERATE_BUZZ" : "EXCELLENT_CALL_READY",
    crowdInfluencePct: i >= 8 && i <= 18 ? 60 : 10,
  })),
  quietestWorkHours: "06:00 - 09:00 & 20:00 - 23:00",
  peakHazardHours: "12:30 - 14:00 (Lunch Rush)",
  hasQuietZone: true,
};

describe("EdgeAcousticForecaster Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports named and default components identically", () => {
    expect(EdgeAcousticForecaster).toBeDefined();
    expect(DefaultEdgeAcousticForecaster).toBe(EdgeAcousticForecaster);
  });

  it("renders forecast header, 24-hour decibel bars, and advisory with initialReport", () => {
    render(
      <EdgeAcousticForecaster
        venueId="venue-blr-01"
        venueName="Koramangala Tech Hub"
        initialReport={mockReport}
      />
    );

    expect(screen.getByTestId("edge-acoustic-forecaster")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-header-banner")).toBeInTheDocument();
    expect(screen.getByText(/24-Hour Predictive Noise Forecasting/i)).toBeInTheDocument();
    expect(screen.getByText(/Koramangala Tech Hub/i)).toBeInTheDocument();

    // 24 hour bars
    expect(screen.getByTestId("forecast-chart-container")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-hour-bar-0")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-hour-bar-12")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-hour-bar-23")).toBeInTheDocument();

    // Badges
    expect(screen.getByTestId("quiet-work-hours-badge")).toHaveTextContent("06:00 - 09:00 & 20:00 - 23:00");
    expect(screen.getByTestId("peak-hazard-hours-badge")).toHaveTextContent("12:30 - 14:00 (Lunch Rush)");
  });

  it("renders spectral energy bands, dominant profile, and video call advisory cards", () => {
    render(<EdgeAcousticForecaster initialReport={mockReport} />);

    // Spectral bands
    const spectralCard = screen.getByTestId("spectral-bands-card");
    expect(spectralCard).toBeInTheDocument();
    expect(spectralCard).toHaveTextContent("20%"); // speech
    expect(spectralCard).toHaveTextContent("10%"); // clatter
    expect(spectralCard).toHaveTextContent("15%"); // rumble

    // Dominant Profile
    const profileCard = screen.getByTestId("dominant-profile-card");
    expect(profileCard).toBeInTheDocument();
    expect(profileCard).toHaveTextContent("39 dB");
    expect(profileCard).toHaveTextContent("SILENT FOCUS");
    expect(profileCard).toHaveTextContent("18 dB");

    // Advisory
    const advisoryCard = screen.getByTestId("video-call-advisory-card");
    expect(advisoryCard).toBeInTheDocument();
    expect(advisoryCard).toHaveTextContent("EXCELLENT CALL READY");
    expect(advisoryCard).toHaveTextContent("Ideal for high-stakes video conferences and presentations.");
  });

  it("merges custom className and custom data-testid via cn utility", () => {
    render(
      <EdgeAcousticForecaster
        initialReport={mockReport}
        className="custom-forecaster-class shadow-cyan-500"
        data-testid="custom-forecaster-root"
      />
    );

    const root = screen.getByTestId("custom-forecaster-root");
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass("custom-forecaster-class");
    expect(root).toHaveClass("shadow-cyan-500");
  });

  it("handles mouse hover on forecast bars without errors", () => {
    render(<EdgeAcousticForecaster initialReport={mockReport} />);

    const bar = screen.getByTestId("forecast-hour-bar-10");
    fireEvent.mouseEnter(bar);
    fireEvent.mouseLeave(bar);
  });

  it("renders loading indicator when no initialReport is provided and fetch is pending", () => {
    // Mock fetch that doesn't resolve immediately
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));

    render(<EdgeAcousticForecaster initialReport={null} />);

    expect(screen.getByTestId("forecast-loading-indicator")).toBeInTheDocument();
    expect(screen.getByText("Synthesizing acoustic time-series and crowd models...")).toBeInTheDocument();
  });

  it("fetches report on mount when initialReport is null", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        success: true,
        report: mockReport,
      }),
    } as any);

    render(<EdgeAcousticForecaster venueId="venue-sf-99" initialReport={null} />);

    await waitFor(() => {
      expect(screen.getByTestId("forecast-chart-container")).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith("/api/analytics/noise-forecast?venueId=venue-sf-99");
  });

  it("manages live microphone FFT listening lifecycle safely", async () => {
    const mockTrack = { stop: jest.fn() };
    const mockStream = {
      getTracks: () => [mockTrack],
    };

    const mockAnalyser = {
      fftSize: 256,
      smoothingTimeConstant: 0.8,
      frequencyBinCount: 128,
      getByteFrequencyData: jest.fn((arr: Uint8Array) => {
        arr.fill(50);
      }),
    };

    const mockSource = {
      connect: jest.fn(),
    };

    const mockAudioContext = {
      createAnalyser: () => mockAnalyser,
      createMediaStreamSource: () => mockSource,
      close: jest.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(mockStream),
      },
    });

    (window as any).AudioContext = jest.fn().mockImplementation(() => mockAudioContext);

    const { unmount } = render(<EdgeAcousticForecaster initialReport={mockReport} />);

    const liveBtn = screen.getByTestId("live-mic-btn");
    expect(liveBtn).toHaveTextContent("Run Edge Mic Classifier");

    // Start live mic
    fireEvent.click(liveBtn);

    await waitFor(() => {
      expect(liveBtn).toHaveTextContent("Stop Live Mic FFT");
    });

    // Stop live mic
    fireEvent.click(liveBtn);

    await waitFor(() => {
      expect(liveBtn).toHaveTextContent("Run Edge Mic Classifier");
    });
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mockAudioContext.close).toHaveBeenCalled();

    // Start again and unmount to verify cleanup
    fireEvent.click(liveBtn);
    await waitFor(() => {
      expect(liveBtn).toHaveTextContent("Stop Live Mic FFT");
    });

    unmount();
    expect(mockTrack.stop).toHaveBeenCalledTimes(2);
  });
});
