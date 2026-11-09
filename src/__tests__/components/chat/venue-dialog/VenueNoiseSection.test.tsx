import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  VenueNoiseSection,
  VenueNoiseSectionProps,
} from "@/components/chat/venue-dialog/VenueNoiseSection";
import type { Venue } from "@/components/chat/ChatMessages";

// Mock next/dynamic
jest.mock("next/dynamic", () => () => {
  const DynamicMock = (props: any) => (
    <div data-testid="mock-dynamic-chart" data-props={JSON.stringify(props)} />
  );
  DynamicMock.displayName = "DynamicMock";
  return DynamicMock;
});

// Mock child subcomponents for isolated and reliable section unit testing
jest.mock("@/components/chat/RatingDistribution", () => ({
  RatingDistribution: ({
    activeMetric,
    venueName,
    onClose,
  }: {
    activeMetric: string;
    venueName?: string;
    onClose?: () => void;
  }) => (
    <div
      data-testid="mock-rating-distribution"
      data-metric={activeMetric}
      data-venue={venueName}
    >
      <span>Rating Distribution for {activeMetric}</span>
      <button
        type="button"
        data-testid="mock-close-distribution-btn"
        onClick={onClose}
      >
        Close Distribution
      </button>
    </div>
  ),
}));

jest.mock("@/components/noise/AmbientNoiseSpectrumVisualizer", () => ({
  AmbientNoiseSpectrumVisualizer: ({
    venueId,
    venueName,
    noiseLevel,
  }: {
    venueId?: string;
    venueName?: string;
    noiseLevel?: string | null;
  }) => (
    <div
      data-testid="mock-spectrum-visualizer"
      data-venue-id={venueId}
      data-venue-name={venueName}
      data-noise-level={noiseLevel}
    >
      Spectrum Visualizer
    </div>
  ),
}));

jest.mock("@/components/noise/NoiseReportingWidget", () => ({
  NoiseReportingWidget: ({
    venueId,
    venueName,
  }: {
    venueId?: string;
    venueName?: string;
  }) => (
    <div
      data-testid="mock-noise-reporting-widget"
      data-venue-id={venueId}
      data-venue-name={venueName}
    >
      Noise Reporting
    </div>
  ),
}));

jest.mock("@/components/noise/AmbientNoiseTrendGraph", () => ({
  AmbientNoiseTrendGraph: ({
    venueId,
    forecast,
  }: {
    venueId?: string;
    forecast?: any[];
  }) => (
    <div
      data-testid="mock-noise-trend-graph"
      data-venue-id={venueId}
      data-forecast-count={forecast?.length}
    >
      Noise Trend Graph
    </div>
  ),
}));

jest.mock("@/components/audio/AudioEqualizer", () => ({
  AudioEqualizer: ({ venueName }: { venueName?: string }) => (
    <div data-testid="mock-audio-equalizer" data-venue-name={venueName}>
      Audio Equalizer
    </div>
  ),
}));

describe("VenueNoiseSection Component Suite", () => {
  const baseVenue: Venue = {
    id: "venue-101",
    name: "Cyber Cafe Hub",
    address: "123 Tech Boulevard",
    category: "coworking",
    wifiSpeed: 120,
    wifiQuality: 5,
    hasOutlets: true,
    outletDensity: "high_density",
    noiseLevel: "quiet",
    lighting: "natural_bright",
    wifi: true,
    hasErgonomic: true,
    musicStyle: "lofi",
    hasPhoneBooths: true,
    outletLocations: ["under_desks", "wall_sockets", "central_table"],
  };

  const defaultProps: VenueNoiseSectionProps = {
    venue: baseVenue,
    reviews: [
      {
        id: "r1",
        wifiQuality: 5,
        hasOutlets: true,
        noiseLevel: "quiet",
      },
    ],
    wifiPredictions: [{ hour: 10, speed: 100 }],
    occupancyData: [{ hour: 10, count: 12 }],
    noiseForecast: [
      {
        hour: "10:00",
        db: 48,
        label: "Quiet",
        color: "#22c55e",
        timestamp: "2026-10-30T10:00:00Z",
        occupancyFactor: 0.3,
      },
    ],
    activeDistribution: null,
    setActiveDistribution: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Quick Metric Cards & A11y", () => {
    it("renders WiFi speed, formatted outlet density, noise level, and lighting correctly", () => {
      render(<VenueNoiseSection {...defaultProps} />);

      const wifiBtn = screen.getByTestId("venue-noise-metric-wifi");
      expect(wifiBtn).toHaveTextContent("120M");
      expect(wifiBtn).toHaveAttribute("aria-pressed", "false");
      expect(wifiBtn).toHaveAttribute(
        "aria-label",
        "Toggle WiFi rating distribution",
      );

      const powerBtn = screen.getByTestId("venue-noise-metric-power");
      expect(powerBtn).toHaveTextContent("High Density");
      expect(powerBtn).toHaveAttribute("aria-pressed", "false");
      expect(powerBtn).toHaveAttribute(
        "aria-label",
        "Toggle outlets and power rating distribution",
      );

      const noiseBtn = screen.getByTestId("venue-noise-metric-noise");
      expect(noiseBtn).toHaveTextContent("quiet");
      expect(noiseBtn).toHaveAttribute("aria-pressed", "false");
      expect(noiseBtn).toHaveAttribute(
        "aria-label",
        "Toggle noise rating distribution",
      );

      const lightingCard = screen.getByTestId("venue-noise-metric-lighting");
      expect(lightingCard).toHaveTextContent("natural bright");
    });

    it("renders fallback metric values when speed or formatting props are omitted", () => {
      const sparseVenue: Venue = {
        id: "sparse-1",
        name: "Minimalist Lounge",
        address: "404 Nowhere St",
        category: "cafe",
        wifiQuality: 3,
        hasOutlets: false,
      };

      render(
        <VenueNoiseSection
          {...defaultProps}
          venue={sparseVenue}
          activeDistribution={null}
        />,
      );

      expect(screen.getByTestId("venue-noise-metric-wifi")).toHaveTextContent(
        "3/5",
      );
      expect(screen.getByTestId("venue-noise-metric-power")).toHaveTextContent(
        "No",
      );
      expect(screen.getByTestId("venue-noise-metric-noise")).toHaveTextContent(
        "Normal",
      );
      expect(screen.getByTestId("venue-noise-metric-lighting")).toHaveTextContent(
        "Normal",
      );
    });

    it("toggles active distribution when metric buttons are clicked", () => {
      const setActiveDistribution = jest.fn();
      render(
        <VenueNoiseSection
          {...defaultProps}
          setActiveDistribution={setActiveDistribution}
        />,
      );

      // Click WiFi button
      fireEvent.click(screen.getByTestId("venue-noise-metric-wifi"));
      expect(setActiveDistribution).toHaveBeenCalledWith("wifi");

      // Click Power button
      fireEvent.click(screen.getByTestId("venue-noise-metric-power"));
      expect(setActiveDistribution).toHaveBeenCalledWith("outlets");

      // Click Noise button
      fireEvent.click(screen.getByTestId("venue-noise-metric-noise"));
      expect(setActiveDistribution).toHaveBeenCalledWith("noise");
    });

    it("untoggles when the currently active metric is clicked again", () => {
      const setActiveDistribution = jest.fn();
      render(
        <VenueNoiseSection
          {...defaultProps}
          activeDistribution="wifi"
          setActiveDistribution={setActiveDistribution}
        />,
      );

      const wifiBtn = screen.getByTestId("venue-noise-metric-wifi");
      expect(wifiBtn).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(wifiBtn);
      expect(setActiveDistribution).toHaveBeenCalledWith(null);
    });
  });

  describe("Rating Distribution & Subcomponents", () => {
    it("renders RatingDistribution component when activeDistribution is set and triggers close", () => {
      const setActiveDistribution = jest.fn();
      render(
        <VenueNoiseSection
          {...defaultProps}
          activeDistribution="noise"
          setActiveDistribution={setActiveDistribution}
        />,
      );

      expect(
        screen.getByTestId("venue-rating-distribution-container"),
      ).toBeInTheDocument();
      const mockDist = screen.getByTestId("mock-rating-distribution");
      expect(mockDist).toHaveAttribute("data-metric", "noise");
      expect(mockDist).toHaveAttribute("data-venue", "Cyber Cafe Hub");

      fireEvent.click(screen.getByTestId("mock-close-distribution-btn"));
      expect(setActiveDistribution).toHaveBeenCalledWith(null);
    });

    it("renders ambient spectrum visualizer, noise reporting widget, and audio equalizer with correct props", () => {
      render(<VenueNoiseSection {...defaultProps} />);

      const spectrum = screen.getByTestId("mock-spectrum-visualizer");
      expect(spectrum).toHaveAttribute("data-venue-id", "venue-101");
      expect(spectrum).toHaveAttribute("data-venue-name", "Cyber Cafe Hub");
      expect(spectrum).toHaveAttribute("data-noise-level", "quiet");

      const reporting = screen.getByTestId("mock-noise-reporting-widget");
      expect(reporting).toHaveAttribute("data-venue-id", "venue-101");
      expect(reporting).toHaveAttribute("data-venue-name", "Cyber Cafe Hub");

      const equalizer = screen.getByTestId("mock-audio-equalizer");
      expect(equalizer).toHaveAttribute("data-venue-name", "Cyber Cafe Hub");
    });
  });

  describe("Forecast Graphs & Empty Data Resilience", () => {
    it("renders forecast graphs container when noiseForecast has elements", () => {
      render(<VenueNoiseSection {...defaultProps} />);

      expect(
        screen.getByTestId("noise-forecast-graphs-container"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("mock-noise-trend-graph")).toBeInTheDocument();
    });

    it("omits forecast graphs container when noiseForecast is empty", () => {
      render(<VenueNoiseSection {...defaultProps} noiseForecast={[]} />);

      expect(
        screen.queryByTestId("noise-forecast-graphs-container"),
      ).not.toBeInTheDocument();
    });

    it("gracefully tolerates null and undefined array props without throwing", () => {
      expect(() => {
        render(
          <VenueNoiseSection
            venue={baseVenue}
            reviews={undefined as any}
            wifiPredictions={undefined as any}
            occupancyData={undefined as any}
            noiseForecast={null as any}
            activeDistribution={null}
          />,
        );
      }).not.toThrow();

      expect(
        screen.queryByTestId("noise-forecast-graphs-container"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("ambient-noise-spectrum-container"),
      ).toBeInTheDocument();
    });
  });

  describe("Intelligence Brief & Badges", () => {
    it("renders collaborative text for cafe category and ergonomic feature description", () => {
      const cafeVenue: Venue = {
        ...baseVenue,
        category: "cafe",
        hasErgonomic: true,
      };

      render(<VenueNoiseSection {...defaultProps} venue={cafeVenue} />);

      const brief = screen.getByTestId("venue-intelligence-brief");
      expect(brief).toHaveTextContent("optimal for collaborative sessions");
      expect(brief).toHaveTextContent(
        "The workspace features verified ergonomic chairs",
      );
    });

    it("renders music style badges for lofi, classical_jazz, no_music, and phone booths", () => {
      const { rerender } = render(
        <VenueNoiseSection {...defaultProps} venue={baseVenue} />,
      );

      expect(screen.getByTestId("badge-music-lofi")).toHaveTextContent(
        "Lo-Fi/Chill Beats",
      );
      expect(screen.getByTestId("badge-phone-booths")).toHaveTextContent(
        "Soundproof Booths Available",
      );

      // Re-render with classical_jazz
      rerender(
        <VenueNoiseSection
          {...defaultProps}
          venue={{
            ...baseVenue,
            musicStyle: "classical_jazz",
            hasPhoneBooths: false,
          }}
        />,
      );
      expect(
        screen.getByTestId("badge-music-classical-jazz"),
      ).toHaveTextContent("Classical/Jazz Background");
      expect(
        screen.queryByTestId("badge-phone-booths"),
      ).not.toBeInTheDocument();

      // Re-render with no_music
      rerender(
        <VenueNoiseSection
          {...defaultProps}
          venue={{
            ...baseVenue,
            musicStyle: "no_music",
          }}
        />,
      );
      expect(screen.getByTestId("badge-music-no-music")).toHaveTextContent(
        "No Music Played",
      );
    });

    it("formats outlet locations with spaces replacing underscores", () => {
      render(<VenueNoiseSection {...defaultProps} />);

      const outletBadge = screen.getByTestId("badge-outlet-locations");
      expect(outletBadge).toHaveTextContent(
        "Outlets: under desks, wall sockets, central table",
      );
    });
  });
});
