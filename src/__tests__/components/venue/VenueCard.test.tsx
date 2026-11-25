import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  formatTravelDuration,
  haversineDistanceKm,
  TRANSIT_SPEED_KMH,
  VenueCard,
  WALKING_SPEED_KMH,
} from "@/components/venue/VenueCard";

const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("VenueCard travel time estimates & chips", () => {
  const bhandupStation = { lat: 19.1695, lng: 72.9369 };
  const sampleVenue = {
    id: "venue-1",
    name: "Bhandup Hub Co-Work",
    address: "LBS Marg, Bhandup West, Mumbai",
    lat: 19.1765,
    lng: 72.9395,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("computes Haversine distance and walk/transit estimates accurately", () => {
    const km = haversineDistanceKm(bhandupStation, {
      lat: sampleVenue.lat,
      lng: sampleVenue.lng,
    });
    expect(km).toBeGreaterThan(0.7);
    expect(km).toBeLessThan(1.1);

    const expectedWalkMin = Math.max(
      1,
      Math.round((km / WALKING_SPEED_KMH) * 60),
    );
    const expectedTransitMin = Math.max(
      1,
      Math.round((km / TRANSIT_SPEED_KMH) * 60),
    );

    expect(expectedWalkMin).toBeGreaterThan(expectedTransitMin);
    expect(formatTravelDuration(75)).toBe("1h 15m");
    expect(formatTravelDuration(120)).toBe("2h");
  });

  it("renders walk and transit chips beside the venue address when userLocation is provided", () => {
    render(<VenueCard venue={sampleVenue} userLocation={bhandupStation} />);

    expect(screen.getByTestId("venue-address")).toHaveTextContent(
      "LBS Marg, Bhandup West, Mumbai",
    );
    expect(screen.getByTestId("venue-travel-chips")).toBeInTheDocument();
    expect(screen.getByTestId("venue-walk-chip")).toHaveTextContent(/min walk/);
    expect(screen.getByTestId("venue-transit-chip")).toHaveTextContent(
      /min transit/,
    );
  });

  it("hides travel chips gracefully when userLocation is missing or null", () => {
    const { rerender } = render(<VenueCard venue={sampleVenue} />);
    expect(screen.queryByTestId("venue-travel-chips")).not.toBeInTheDocument();

    rerender(<VenueCard venue={sampleVenue} userLocation={null} />);
    expect(screen.queryByTestId("venue-travel-chips")).not.toBeInTheDocument();
  });

  describe("Copy venue address functionality (#9719)", () => {
    it("renders the copy address button with accessible ARIA label", () => {
      render(<VenueCard venue={sampleVenue} />);

      const copyBtn = screen.getByTestId("copy-venue-address-btn");
      expect(copyBtn).toBeInTheDocument();
      expect(copyBtn).toHaveAttribute(
        "aria-label",
        `Copy address for ${sampleVenue.name}`,
      );
    });

    it("copies address to clipboard via navigator.clipboard and displays confirmation for 2 seconds", async () => {
      jest.useFakeTimers();
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(<VenueCard venue={sampleVenue} />);
      const copyBtn = screen.getByTestId("copy-venue-address-btn");

      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(writeTextMock).toHaveBeenCalledWith(
        "LBS Marg, Bhandup West, Mumbai",
      );
      expect(mockToast).toHaveBeenCalledWith(
        "Venue address copied to clipboard!",
        "success",
      );
      expect(
        screen.getByTestId("copy-address-success-label"),
      ).toHaveTextContent("Copied!");
      expect(copyBtn).toHaveAttribute(
        "aria-label",
        "Address copied to clipboard",
      );

      // Advance timers by 2000ms
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(
        screen.queryByTestId("copy-address-success-label"),
      ).not.toBeInTheDocument();
      expect(copyBtn).toHaveAttribute(
        "aria-label",
        `Copy address for ${sampleVenue.name}`,
      );
    });

    it("falls back to document.execCommand when navigator.clipboard throws or is unavailable", async () => {
      Object.assign(navigator, { clipboard: undefined });
      const execCommandMock = jest.fn().mockReturnValue(true);
      document.execCommand = execCommandMock;

      render(<VenueCard venue={sampleVenue} />);
      const copyBtn = screen.getByTestId("copy-venue-address-btn");

      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(execCommandMock).toHaveBeenCalledWith("copy");
      expect(mockToast).toHaveBeenCalledWith(
        "Venue address copied to clipboard!",
        "success",
      );
    });

    it("does not trigger card onSelect when clicking copy button", async () => {
      const onSelectMock = jest.fn();
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      render(<VenueCard venue={sampleVenue} onSelect={onSelectMock} />);
      const copyBtn = screen.getByTestId("copy-venue-address-btn");

      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(writeTextMock).toHaveBeenCalled();
      expect(onSelectMock).not.toHaveBeenCalled();
    });

    it("does not render copy button when venue has no address", () => {
      const venueWithoutAddress = { ...sampleVenue, address: "" };
      render(<VenueCard venue={venueWithoutAddress} />);

      expect(
        screen.queryByTestId("copy-venue-address-btn"),
      ).not.toBeInTheDocument();
    });
  });
});
