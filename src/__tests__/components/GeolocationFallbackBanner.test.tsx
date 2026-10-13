import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  GeolocationFallbackBanner,
  GeolocationFallbackSkeleton,
} from "@/components/venues/GeolocationFallbackBanner";
import * as userLocationHook from "@/hooks/useUserLocation";

describe("GeolocationFallbackBanner Component", () => {
  const mockOnLocationSelected = jest.fn();
  const mockOnDismiss = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Skeleton Shimmer Variant (status === 'prompt')", () => {
    it("renders skeleton shimmer placeholder when status === 'prompt'", () => {
      render(
        <GeolocationFallbackBanner
          status="prompt"
          onLocationSelected={mockOnLocationSelected}
          onDismiss={mockOnDismiss}
        />,
      );

      const skeleton = screen.getByTestId("geolocation-shimmer-skeleton");
      expect(skeleton).toBeInTheDocument();
      expect(skeleton).toHaveAttribute("role", "status");
      expect(skeleton).toHaveAttribute("aria-busy", "true");
      expect(skeleton).toHaveAttribute(
        "aria-label",
        "Checking location permission",
      );
      expect(screen.getByTestId("shimmer-sweep")).toBeInTheDocument();
      expect(
        screen.queryByText(/Location access disabled/i),
      ).not.toBeInTheDocument();
    });

    it("renders skeleton shimmer placeholder when variant === 'skeleton' or variant === 'shimmer' or isLoading === true", () => {
      const { rerender } = render(
        <GeolocationFallbackBanner variant="skeleton" />,
      );
      expect(
        screen.getByTestId("geolocation-shimmer-skeleton"),
      ).toBeInTheDocument();

      rerender(<GeolocationFallbackBanner variant="shimmer" />);
      expect(
        screen.getByTestId("geolocation-shimmer-skeleton"),
      ).toBeInTheDocument();

      rerender(<GeolocationFallbackBanner isLoading={true} />);
      expect(
        screen.getByTestId("geolocation-shimmer-skeleton"),
      ).toBeInTheDocument();
    });

    it("standalone GeolocationFallbackSkeleton renders with shimmer overlay and matching container classes", () => {
      render(<GeolocationFallbackSkeleton className="custom-class" />);
      const skeleton = screen.getByTestId("geolocation-shimmer-skeleton");
      expect(skeleton).toBeInTheDocument();
      expect(skeleton).toHaveClass("custom-class");
      expect(skeleton).toHaveClass("min-h-[148px]");
      expect(skeleton).toHaveClass("animate-in fade-in");
    });
  });

  describe("CLS Prevention & Height Reservation", () => {
    it("both skeleton and resolved banner preserve the reserved min-height container to prevent CLS", () => {
      const { rerender } = render(
        <GeolocationFallbackBanner status="prompt" />,
      );
      const skeleton = screen.getByTestId("geolocation-shimmer-skeleton");
      expect(skeleton).toHaveClass("min-h-[148px]");

      rerender(<GeolocationFallbackBanner status="denied" />);
      const banner = screen.getByTestId("geolocation-fallback-banner");
      expect(banner).toHaveClass("min-h-[148px]");
    });
  });

  describe("Fade-in Transition on Permission Resolution", () => {
    it("renders resolved banner with fade-in transition when status === 'denied'", () => {
      render(
        <GeolocationFallbackBanner
          status="denied"
          onLocationSelected={mockOnLocationSelected}
          onDismiss={mockOnDismiss}
        />,
      );

      const banner = screen.getByTestId("geolocation-fallback-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveClass("animate-in fade-in duration-300");
      expect(
        screen.getByRole("heading", { name: /Location access disabled/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("geolocation-shimmer-skeleton"),
      ).not.toBeInTheDocument();
    });

    it("gracefully transitions from skeleton shimmer to resolved banner with fade-in when prompt resolves to denied", () => {
      const { rerender } = render(
        <GeolocationFallbackBanner status="prompt" />,
      );

      expect(
        screen.getByTestId("geolocation-shimmer-skeleton"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("geolocation-fallback-banner"),
      ).not.toBeInTheDocument();

      rerender(<GeolocationFallbackBanner status="denied" />);

      expect(
        screen.queryByTestId("geolocation-shimmer-skeleton"),
      ).not.toBeInTheDocument();
      const banner = screen.getByTestId("geolocation-fallback-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveClass("animate-in fade-in duration-300");
      expect(banner).toHaveClass("min-h-[148px]");
    });

    it("returns null when status === 'granted'", () => {
      const { container } = render(
        <GeolocationFallbackBanner status="granted" />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("Banner Interaction & Manual Geocoding", () => {
    it("dismisses banner when close button is clicked", () => {
      render(
        <GeolocationFallbackBanner status="denied" onDismiss={mockOnDismiss} />,
      );

      const dismissBtn = screen.getByRole("button", {
        name: /Dismiss location warning/i,
      });
      fireEvent.click(dismissBtn);

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId("geolocation-fallback-banner"),
      ).not.toBeInTheDocument();
    });

    it("handles manual location submission and invokes onLocationSelected", async () => {
      const mockGeocode = jest
        .spyOn(userLocationHook, "geocodePostalOrCity")
        .mockResolvedValueOnce({
          lat: 40.7128,
          lng: -74.006,
          displayName: "New York, NY",
        });

      render(
        <GeolocationFallbackBanner
          status="denied"
          onLocationSelected={mockOnLocationSelected}
        />,
      );

      const input = screen.getByLabelText(/Enter city or postal code/i);
      const submitBtn = screen.getByRole("button", { name: /Set Location/i });

      fireEvent.change(input, { target: { value: "New York" } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockGeocode).toHaveBeenCalledWith("New York");
        expect(mockOnLocationSelected).toHaveBeenCalledWith({
          lat: 40.7128,
          lng: -74.006,
          displayName: "New York, NY",
        });
        expect(
          screen.getByText(/Map centered at: New York, NY/i),
        ).toBeInTheDocument();
      });

      mockGeocode.mockRestore();
    });
  });
});
