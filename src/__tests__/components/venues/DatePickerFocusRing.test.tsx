import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueFilterBar } from "@/components/venues/VenueFilterBar";
import { RescheduleModal } from "@/components/bookings/RescheduleModal";
import { MobileVenueDrawer } from "@/components/ui/MobileVenueDrawer";
import type { MapMarker } from "@/types/map";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
  usePathname: jest.fn(),
}));

jest.mock("framer-motion", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    LayoutGroup: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: {
      // eslint-disable-next-line react/display-name
      div: React.forwardRef(
        (
          {
            layoutId,
            children,
            drag: _drag,
            dragConstraints: _dragConstraints,
            dragElastic: _dragElastic,
            ...props
          }: {
            layoutId?: string;
            children?: React.ReactNode;
            drag?: unknown;
            dragConstraints?: unknown;
            dragElastic?: unknown;
            [key: string]: any;
          },
          ref: any,
        ) => (
          <div ref={ref} data-layoutid={layoutId} {...props}>
            {children}
          </div>
        ),
      ),
    },
    useMotionValue: (initial: number) => ({
      get: () => initial,
      set: jest.fn(),
    }),
    useTransform: () => ({ get: () => 0 }),
    animate: jest.fn(),
  };
});

const HIGH_CONTRAST_FOCUS_CLASSES = [
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-cyan-400",
  "focus-visible:ring-offset-2",
  "focus-visible:ring-offset-slate-900",
];

function getLuminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)!
    .map((channel) => parseInt(channel, 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
    );

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function getContrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(getLuminance(foreground), getLuminance(background));
  const darker = Math.min(getLuminance(foreground), getLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("High-contrast focus indicators for date pickers", () => {
  const mockRouter = { replace: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (usePathname as jest.Mock).mockReturnValue("/venues");
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  });

  describe("VenueFilterBar interactive controls", () => {
    it("applies the high-contrast ring to category tabs and amenity pills", () => {
      render(<VenueFilterBar />);

      const categoryTab = screen.getByTestId("venue-category-tab-all");
      const amenityPill = screen.getByTestId("venue-filter-pill-wifi");
      const popoverTrigger = screen.getByTestId("venue-filter-popover-trigger");

      for (const element of [categoryTab, amenityPill, popoverTrigger]) {
        HIGH_CONTRAST_FOCUS_CLASSES.forEach((className) => {
          expect(element).toHaveClass(className);
        });
      }
    });

    it("applies the high-contrast ring to popover actions", () => {
      render(<VenueFilterBar />);
      fireEvent.click(screen.getByTestId("venue-filter-popover-trigger"));

      const closeButton = screen.getByTestId("close-filter-popover-button");
      const resetButton = screen.getByTestId("reset-range-filters-button");
      const applyButton = screen.getByTestId("apply-range-filters-button");

      for (const element of [closeButton, resetButton, applyButton]) {
        HIGH_CONTRAST_FOCUS_CLASSES.forEach((className) => {
          expect(element).toHaveClass(className);
        });
      }
    });
  });

  describe("Booking date and time inputs", () => {
    const venue: MapMarker = {
      id: "venue-1",
      name: "Cozy Bean Cafe",
      category: "cafe",
      address: "123 Market St",
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

    it("applies the high-contrast ring to mobile drawer date/time inputs", () => {
      render(
        <MobileVenueDrawer
          venue={venue}
          isOpen={true}
          onClose={jest.fn()}
          initialSnap="expanded"
        />,
      );

      const dateInput = screen.getByTestId("drawer-booking-date-input");
      const timeInput = screen.getByTestId("drawer-booking-time-input");

      for (const element of [dateInput, timeInput]) {
        HIGH_CONTRAST_FOCUS_CLASSES.forEach((className) => {
          expect(element).toHaveClass(className);
        });
      }
    });

    it("applies the high-contrast ring to reschedule date/time inputs", () => {
      render(
        <RescheduleModal
          booking={{
            id: "booking-1",
            confirmationId: "WS-CONF-888",
            date: "2026-10-20",
            time: "10:00",
            duration: 60,
            venue: { name: "Indie Hub", address: "123 Tech Lane" },
          }}
          isOpen={true}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />,
      );

      const dateInput = screen.getByTestId("reschedule-date-input");
      const timeInput = screen.getByTestId("reschedule-time-input");

      for (const element of [dateInput, timeInput]) {
        HIGH_CONTRAST_FOCUS_CLASSES.forEach((className) => {
          expect(element).toHaveClass(className);
        });

        // Keyboard ring classes must not leak into mouse-only :focus styling.
        expect(element.className).not.toMatch(/(?:^|\s)focus:ring-/);
      }
    });
  });

  describe("WCAG 2.2 AA non-text contrast", () => {
    it("keeps cyan-400 above the 3:1 threshold against slate backdrops", () => {
      const focusRingColor = "#22d3ee"; // cyan-400
      const slate900 = "#0f172a";
      const slate950 = "#020617";

      expect(getContrastRatio(focusRingColor, slate900)).toBeGreaterThanOrEqual(
        3,
      );
      expect(getContrastRatio(focusRingColor, slate950)).toBeGreaterThanOrEqual(
        3,
      );

      // In light mode the dark ring-offset provides the contrast boundary
      // between the cyan ring and the light page background.
      expect(getContrastRatio(slate900, "#ffffff")).toBeGreaterThanOrEqual(3);
    });
  });
});
