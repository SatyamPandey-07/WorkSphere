import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  VenueDetailModal,
  VenueDeveloperTab,
  generateVenueCurlSnippet,
} from "@/components/venues/VenueDetailModal";

let latestEventSource: {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: jest.Mock;
} | null = null;
const originalEventSource = global.EventSource;

beforeAll(() => {
  global.EventSource = jest.fn().mockImplementation(() => {
    latestEventSource = {
      onmessage: null,
      onerror: null,
      close: jest.fn(),
    };
    return latestEventSource;
  }) as any;
});

afterAll(() => {
  global.EventSource = originalEventSource;
});

describe("VenueDetailModal Developer Tab & cURL Snippet Generator", () => {
  describe("generateVenueCurlSnippet", () => {
    it("generates correct cURL command for a given venueId", () => {
      const snippet = generateVenueCurlSnippet("venue-xyz-123");
      expect(snippet).toBe(
        "curl -s https://work-sphere.vercel.app/api/venues/venue-xyz-123 | jq .",
      );
    });

    it("handles fallback placeholder when venueId is empty", () => {
      const snippet = generateVenueCurlSnippet("");
      expect(snippet).toBe(
        "curl -s https://work-sphere.vercel.app/api/venues/{venueId} | jq .",
      );
    });
  });

  describe("VenueDeveloperTab Component", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("renders formatted cURL command inside terminal window", () => {
      render(
        <VenueDeveloperTab venueId="venue-999" venueName="Tech Hub Cafe" />,
      );

      expect(
        screen.getByTestId("venue-developer-tab-content"),
      ).toBeInTheDocument();
      expect(screen.getByText("Tech Hub Cafe")).toBeInTheDocument();

      const codeElement = screen.getByTestId("curl-command-text");
      expect(codeElement).toBeInTheDocument();
      expect(codeElement).toHaveTextContent(
        "curl -s https://work-sphere.vercel.app/api/venues/venue-999 | jq .",
      );
    });

    it("provides one-click copy button with animated 'Copied!' checkmark feedback", async () => {
      // Mock navigator.clipboard
      const mockWriteText = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: mockWriteText,
        },
      });

      render(<VenueDeveloperTab venueId="venue-42" />);

      const copyBtn = screen.getByTestId("copy-curl-button");
      expect(copyBtn).toHaveTextContent("Copy");

      // Click copy button
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(mockWriteText).toHaveBeenCalledWith(
        "curl -s https://work-sphere.vercel.app/api/venues/venue-42 | jq .",
      );
      expect(copyBtn).toHaveTextContent("Copied!");

      // Fast forward past feedback timeout (2000ms)
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(copyBtn).toHaveTextContent("Copy");
    });
  });

  describe("VenueDetailModal Integration", () => {
    it("renders live AQI updates and returns to calibrating when the stream is interrupted", () => {
      const mockVenue = {
        id: "venue-sf-01",
        name: "Mission Roasters",
        lat: 37.76,
        lng: -122.42,
        category: "cafe",
      } as any;

      render(
        <VenueDetailModal
          venue={mockVenue}
          isOpen={true}
          isFavorited={false}
          onClose={jest.fn()}
          onGetDirections={jest.fn()}
          onToggleFavorite={jest.fn()}
        />,
      );

      expect(screen.getByTestId("air-quality-calibrating")).toBeInTheDocument();

      act(() => {
        latestEventSource?.onmessage?.({
          data: JSON.stringify({
            type: "air_quality",
            available: true,
            payload: {
              co2: 450,
              pm25: 6,
              tvoc: 80,
              timestamp: "2026-11-18T15:00:00.000Z",
            },
          }),
        } as MessageEvent);
      });
      expect(screen.getByTestId("air-quality-badge")).toHaveTextContent(
        "AQI 28 · Good",
      );

      const connectedEventSource = latestEventSource;
      fireEvent(document, new Event("visibilitychange"));
      expect(connectedEventSource?.close).toHaveBeenCalled();
      expect(screen.getByTestId("air-quality-calibrating")).toBeInTheDocument();

      act(() => {
        latestEventSource?.onmessage?.({
          data: JSON.stringify({
            type: "air_quality",
            available: true,
            payload: {
              co2: 450,
              pm25: 6,
              tvoc: 80,
              timestamp: "2026-11-18T15:00:15.000Z",
            },
          }),
        } as MessageEvent);
      });
      expect(screen.getByTestId("air-quality-badge")).toHaveTextContent(
        "AQI 28 · Good",
      );

      act(() => {
        latestEventSource?.onerror?.({} as Event);
      });
      expect(screen.getByTestId("air-quality-calibrating")).toBeInTheDocument();
    });

    it("renders Developer tab and displays cURL snippet on tab selection", () => {
      const mockVenue = {
        id: "venue-sf-01",
        name: "Mission Roasters",
        lat: 37.76,
        lng: -122.42,
        category: "cafe",
      } as any;

      render(
        <VenueDetailModal
          venue={mockVenue}
          isOpen={true}
          isFavorited={false}
          onClose={jest.fn()}
          onGetDirections={jest.fn()}
          onToggleFavorite={jest.fn()}
          initialTab="overview"
        />,
      );

      // Verify the Developer tab button is present
      const developerTab = screen.getByTestId("tab-developer");
      expect(developerTab).toBeInTheDocument();
      expect(developerTab).toHaveTextContent("Developer");

      // Initially on overview tab
      expect(
        screen.queryByTestId("venue-developer-tab-content"),
      ).not.toBeInTheDocument();

      // Click the Developer tab
      fireEvent.click(developerTab);

      // Now developer tab content is visible with the cURL command
      expect(
        screen.getByTestId("venue-developer-tab-content"),
      ).toBeInTheDocument();
      const codeElement = screen.getByTestId("curl-command-text");
      expect(codeElement).toHaveTextContent(
        "curl -s https://work-sphere.vercel.app/api/venues/venue-sf-01 | jq .",
      );
    });

    it("renders RadarSweepHUD overlay when currentDb and noiseHistory are provided", () => {
      const mockVenue = {
        id: "venue-sf-01",
        name: "Mission Roasters",
        lat: 37.76,
        lng: -122.42,
        category: "cafe",
      } as any;

      render(
        <VenueDetailModal
          venue={mockVenue}
          isOpen={true}
          isFavorited={false}
          onClose={jest.fn()}
          onGetDirections={jest.fn()}
          onToggleFavorite={jest.fn()}
          currentDb={54}
          noiseHistory={[45, 50, 54]}
        />,
      );

      const radarOverlay = screen.getByTestId("venue-modal-radar-sweep-hud");
      expect(radarOverlay).toBeInTheDocument();
      expect(screen.getByTestId("radar-current-db")).toHaveTextContent("54");
      expect(screen.getByTestId("radar-status-badge")).toHaveTextContent("Moderate");
    });

    it("does not crash when noise data is missing", () => {
      const mockVenue = {
        id: "venue-sf-02",
        name: "Quiet Library",
        lat: 37.76,
        lng: -122.42,
        category: "library",
      } as any;

      render(
        <VenueDetailModal
          venue={mockVenue}
          isOpen={true}
          isFavorited={false}
          onClose={jest.fn()}
          onGetDirections={jest.fn()}
          onToggleFavorite={jest.fn()}
          showRadarSweep={false}
        />,
      );

      expect(
        screen.queryByTestId("venue-modal-radar-sweep-hud"),
      ).not.toBeInTheDocument();
    });
  });
});
