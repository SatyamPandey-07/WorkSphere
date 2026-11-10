import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  VenueDetailModal,
  VenueDeveloperTab,
  generateVenueCurlSnippet,
} from "@/components/venues/VenueDetailModal";

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
  });
});
