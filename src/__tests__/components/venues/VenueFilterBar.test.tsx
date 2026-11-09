import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultVenueFilterBar, {
  VenueFilterBar,
  DEFAULT_VENUE_FILTERS,
} from "@/components/venues/VenueFilterBar";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Ambient declarations to avoid Jest / TS global resolution issues in test env
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => any;
declare const beforeEach: (fn: () => void) => void;
declare const jest: any;

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
  usePathname: jest.fn(),
}));

describe("VenueFilterBar Component", () => {
  const mockReplace = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ replace: mockReplace });
    (usePathname as jest.Mock).mockReturnValue("/venues");
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  });

  describe("Exports", () => {
    it("exports VenueFilterBar as both named and default export", () => {
      expect(DefaultVenueFilterBar).toBe(VenueFilterBar);
    });
  });

  describe("Rendering Default State", () => {
    it("renders default filters with icons, labels, and touch targets", () => {
      render(<VenueFilterBar />);

      expect(screen.getByTestId("venue-filter-bar")).toBeInTheDocument();
      expect(screen.getByTestId("venue-filter-bar-scroll")).toBeInTheDocument();

      DEFAULT_VENUE_FILTERS.forEach((item) => {
        const pill = screen.getByTestId(`venue-filter-pill-${item.id}`);
        expect(pill).toBeInTheDocument();
        expect(pill).toHaveTextContent(item.label);
        expect(pill).toHaveAttribute("aria-checked", "false");
        // Verify minimum 44px height class for Apple HIG touch target
        expect(pill.className).toContain("min-h-[44px]");
      });
    });
  });

  describe("Empty Filters Handling", () => {
    it("returns null when filters list is empty", () => {
      const { container } = render(<VenueFilterBar filters={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Toggling Filters", () => {
    it("calls onToggleFilter and updates URL when a pill is clicked", () => {
      const onToggle = jest.fn();
      render(<VenueFilterBar onToggleFilter={onToggle} />);

      const wifiPill = screen.getByTestId("venue-filter-pill-wifi");
      fireEvent.click(wifiPill);

      expect(onToggle).toHaveBeenCalledWith("wifi", true);
      expect(mockReplace).toHaveBeenCalledWith("/venues?wifi=true", {
        scroll: false,
      });
    });

    it("respects controlled selectedFilters", () => {
      render(<VenueFilterBar selectedFilters={["wifi"]} />);

      const wifiPill = screen.getByTestId("venue-filter-pill-wifi");
      expect(wifiPill).toHaveAttribute("aria-checked", "true");
      expect(wifiPill).toHaveAttribute("data-selected", "true");

      const outletsPill = screen.getByTestId("venue-filter-pill-outlets");
      expect(outletsPill).toHaveAttribute("aria-checked", "false");
    });
  });

  describe("Custom Range Filters Popover Integration", () => {
    it("renders the popover trigger button and opens the filter popover on click", () => {
      render(<VenueFilterBar />);

      const triggerBtn = screen.getByTestId("venue-filter-popover-trigger");
      expect(triggerBtn).toBeInTheDocument();
      expect(triggerBtn).toHaveTextContent("Noise & Wi-Fi");

      // Popover should initially be closed
      expect(screen.queryByTestId("venue-filter-popover")).not.toBeInTheDocument();

      // Open popover
      fireEvent.click(triggerBtn);
      expect(screen.getByTestId("venue-filter-popover")).toBeInTheDocument();
      expect(screen.getByTestId("decibel-range-slider")).toBeInTheDocument();
      expect(screen.getByTestId("wifi-range-slider")).toBeInTheDocument();
    });

    it("applies custom range filters to URL and calls callbacks when Apply is clicked", () => {
      const onDecibelChange = jest.fn();
      const onWifiChange = jest.fn();
      render(
        <VenueFilterBar
          onDecibelRangeChange={onDecibelChange}
          onWifiSpeedRangeChange={onWifiChange}
        />,
      );

      // Open popover
      fireEvent.click(screen.getByTestId("venue-filter-popover-trigger"));

      // Click Apply Filters
      const applyBtn = screen.getByTestId("apply-range-filters-button");
      fireEvent.click(applyBtn);

      expect(onDecibelChange).toHaveBeenCalled();
      expect(onWifiChange).toHaveBeenCalled();
      // Popover closes after apply
      expect(screen.queryByTestId("venue-filter-popover")).not.toBeInTheDocument();
    });

    it("resets range filters to defaults when Reset Defaults is clicked", () => {
      const onDecibelChange = jest.fn();
      const onWifiChange = jest.fn();
      render(
        <VenueFilterBar
          decibelRange={[40, 60]}
          wifiSpeedRange={[50, 200]}
          onDecibelRangeChange={onDecibelChange}
          onWifiSpeedRangeChange={onWifiChange}
        />,
      );

      // Open popover
      fireEvent.click(screen.getByTestId("venue-filter-popover-trigger"));

      // Click Reset Defaults
      const resetBtn = screen.getByTestId("reset-range-filters-button");
      fireEvent.click(resetBtn);

      expect(onDecibelChange).toHaveBeenCalledWith([30, 85]);
      expect(onWifiChange).toHaveBeenCalledWith([10, 300]);
    });

    it("closes popover when close button or Escape key is pressed", () => {
      render(<VenueFilterBar />);

      const triggerBtn = screen.getByTestId("venue-filter-popover-trigger");
      fireEvent.click(triggerBtn);
      expect(screen.getByTestId("venue-filter-popover")).toBeInTheDocument();

      // Close via close button
      const closeBtn = screen.getByTestId("close-filter-popover-button");
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId("venue-filter-popover")).not.toBeInTheDocument();

      // Open again and close via Escape key
      fireEvent.click(triggerBtn);
      expect(screen.getByTestId("venue-filter-popover")).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("venue-filter-popover")).not.toBeInTheDocument();
    });
  });
});

