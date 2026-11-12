import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MobileVenueDrawer,
  SNAP_PERCENTAGES,
  DrawerSnapPoint,
} from "@/components/ui/MobileVenueDrawer";
import type { MapMarker } from "@/types/map";

// Mock framer-motion to simplify testing gesture-driven UI
jest.mock("framer-motion", () => {
  const actual = jest.requireActual("framer-motion");
  return {
    ...actual,
    motion: {
      div: React.forwardRef(function MockMotionDiv(
        {
          children,
          className,
          style,
          drag,
          dragConstraints,
          dragElastic,
          onDragEnd,
          "data-testid": dataTestId,
          "data-snap-point": dataSnapPoint,
          ...rest
        }: any,
        ref: any
      ) {
        return (
          <div
            ref={ref}
            className={className}
            style={style}
            data-testid={dataTestId}
            data-snap-point={dataSnapPoint}
            data-drag={String(drag)}
            {...rest}
          >
            {children}
          </div>
        );
      }),
    },
    useMotionValue: (init: any) => ({
      get: () => init,
      set: jest.fn(),
    }),
    useTransform: () => ({
      get: () => 0,
    }),
    animate: jest.fn(),
  };
});

describe("MobileVenueDrawer Component", () => {
  const mockVenue: MapMarker = {
    id: "test-venue-1",
    name: "Cozy Bean Cafe",
    category: "cafe",
    address: "123 Market St, San Francisco, CA",
    rating: 4.8,
    score: 4.8,
    noiseLevel: "quiet",
    openingHours: "08:00 - 18:00",
    hasOutlets: true,
    outletDensity: "Every table",
    position: { lat: 37.7749, lng: -122.4194 },
    amenities: {
      wifi: true,
      wifiSpeed: 120,
      outlets: true,
      quiet: true,
    },
  };

  const defaultProps = {
    venue: mockVenue,
    isOpen: true,
    onClose: jest.fn(),
    onBook: jest.fn(),
    onGetDirections: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Snap point definitions & initial state", () => {
    it("defines 3 snap points corresponding to 15%, 50%, and 90%", () => {
      expect(SNAP_PERCENTAGES.collapsed).toBe(0.15);
      expect(SNAP_PERCENTAGES.half).toBe(0.5);
      expect(SNAP_PERCENTAGES.expanded).toBe(0.9);
    });

    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <MobileVenueDrawer {...defaultProps} isOpen={false} />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when venue is null", () => {
      const { container } = render(
        <MobileVenueDrawer {...defaultProps} venue={null} />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders root and sheet elements when open with venue", () => {
      render(<MobileVenueDrawer {...defaultProps} />);
      expect(screen.getByTestId("mobile-venue-drawer-root")).toBeInTheDocument();
      expect(screen.getByTestId("mobile-venue-drawer")).toBeInTheDocument();
    });
  });

  describe("15% Peek Snap: Title, Rating & Category", () => {
    it("renders venue title and category badge in peek header", () => {
      render(<MobileVenueDrawer {...defaultProps} />);
      expect(screen.getByTestId("drawer-venue-title")).toHaveTextContent(
        "Cozy Bean Cafe"
      );
      expect(screen.getByText("cafe")).toBeInTheDocument();
    });

    it("renders venue rating score", () => {
      render(<MobileVenueDrawer {...defaultProps} />);
      expect(screen.getByTestId("drawer-venue-rating")).toHaveTextContent("4.8");
    });

    it("does not render backdrop when in collapsed snap point to keep map interactive", () => {
      render(
        <MobileVenueDrawer {...defaultProps} initialSnap="collapsed" />
      );
      expect(
        screen.queryByTestId("mobile-drawer-backdrop")
      ).not.toBeInTheDocument();
    });

    it("renders backdrop when in half or expanded snap point", () => {
      render(
        <MobileVenueDrawer {...defaultProps} initialSnap="half" />
      );
      expect(screen.getByTestId("mobile-drawer-backdrop")).toBeInTheDocument();
    });
  });

  describe("50% Half Snap: Amenities & Noise Meter", () => {
    it("renders WiFi, power outlets, and noise metrics", () => {
      render(<MobileVenueDrawer {...defaultProps} />);
      expect(screen.getByTestId("drawer-metric-wifi")).toHaveTextContent("120 Mbps");
      expect(screen.getByTestId("drawer-metric-outlets")).toHaveTextContent(
        "Every table"
      );
      expect(screen.getByTestId("drawer-metric-noise")).toHaveTextContent("quiet");
    });

    it("renders the acoustic noise meter card and level bar indicator", () => {
      render(<MobileVenueDrawer {...defaultProps} />);
      expect(screen.getByTestId("drawer-noise-meter")).toBeInTheDocument();
      expect(screen.getByTestId("drawer-noise-badge")).toHaveTextContent(
        "quiet space"
      );
      expect(screen.getByTestId("drawer-noise-bar")).toHaveClass("bg-emerald-500");
    });
  });

  describe("90% Expanded Snap: Full Details & Booking", () => {
    it("renders opening hours and directions action", () => {
      render(<MobileVenueDrawer {...defaultProps} />);
      expect(screen.getByText("Hours: 08:00 - 18:00")).toBeInTheDocument();
      const directionsBtn = screen.getByTestId("drawer-directions-btn");
      fireEvent.click(directionsBtn);
      expect(defaultProps.onGetDirections).toHaveBeenCalledWith(mockVenue);
    });

    it("renders instant booking form and submits reservation", () => {
      render(<MobileVenueDrawer {...defaultProps} />);
      expect(screen.getByTestId("drawer-booking-form")).toBeInTheDocument();

      const dateInput = screen.getByTestId("drawer-booking-date-input");
      const timeInput = screen.getByTestId("drawer-booking-time-input");
      fireEvent.change(dateInput, { target: { value: "2026-12-01" } });
      fireEvent.change(timeInput, { target: { value: "10:30" } });

      const submitBtn = screen.getByTestId("drawer-submit-booking-btn");
      fireEvent.click(submitBtn);

      // Verify submit button disabled during loading
      expect(submitBtn).toBeDisabled();
    });
  });

  describe("Dismissal & Interaction callbacks", () => {
    it("invokes onClose when close button is clicked", () => {
      render(<MobileVenueDrawer {...defaultProps} />);
      const closeBtn = screen.getByTestId("drawer-close-btn");
      fireEvent.click(closeBtn);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it("toggles between snaps when expand/collapse chevron button is clicked", () => {
      render(
        <MobileVenueDrawer {...defaultProps} initialSnap="collapsed" />
      );
      const expandBtn = screen.getByTestId("drawer-expand-btn");
      fireEvent.click(expandBtn);
      expect(screen.getByTestId("mobile-venue-drawer")).toHaveAttribute(
        "data-snap-point",
        "expanded"
      );
    });
  });
});

