import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ComparisonDrawer,
  ComparisonDrawerProps,
} from "@/components/ComparisonDrawer";
import type { Venue } from "@/types/venue";

jest.mock("@/components/ui/RadarChart", () => ({
  RadarChart: ({ data, labels }: { data: any[]; labels: string[] }) => (
    <div data-testid="mock-radar-chart">
      <span data-testid="radar-chart-labels">{labels.join(",")}</span>
      <div data-testid="radar-chart-series">
        {data.map((d) => (
          <div key={d.name} data-testid={`radar-series-${d.name}`}>
            {d.name}:{d.values.join(",")}
          </div>
        ))}
      </div>
    </div>
  ),
}));

describe("ComparisonDrawer Component (#6903)", () => {
  const mockOnRemoveVenue = jest.fn();
  const mockOnClearAll = jest.fn();
  const mockOnClose = jest.fn();

  const sampleVenues: Venue[] = [
    {
      id: "venue-alpha",
      name: "Alpha Workspace",
      address: "100 Tech Lane",
      city: "Bengaluru",
      state: "Karnataka",
      zip: "560001",
      lat: 12.9716,
      lng: 77.5946,
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      seating: 4,
      coffee: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Venue,
    {
      id: "venue-beta",
      name: "Beta Hub",
      address: "200 Startup Blvd",
      city: "Bengaluru",
      state: "Karnataka",
      zip: "560002",
      lat: 12.972,
      lng: 77.595,
      wifiQuality: 3,
      hasOutlets: false,
      noiseLevel: "moderate",
      seating: 2,
      coffee: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Venue,
    {
      id: "venue-gamma",
      name: "Gamma Studio",
      address: "300 Creative Way",
      city: "Bengaluru",
      state: "Karnataka",
      zip: "560003",
      lat: 12.973,
      lng: 77.596,
      wifiQuality: 4,
      hasOutlets: true,
      noiseLevel: "loud",
      seating: 3,
      coffee: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Venue,
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Guarding & Rendering Thresholds", () => {
    it("renders nothing when selectedVenues has fewer than 2 venues", () => {
      const { container } = render(
        <ComparisonDrawer
          selectedVenues={[sampleVenues[0]]}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when selectedVenues is empty", () => {
      const { container } = render(
        <ComparisonDrawer
          selectedVenues={[]}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when selectedVenues is null or undefined", () => {
      const { container } = render(
        <ComparisonDrawer
          selectedVenues={null as any}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Drawer Header & Radar Chart Visualization", () => {
    it("renders comparing header and radar chart with 2 venues", () => {
      render(
        <ComparisonDrawer
          selectedVenues={[sampleVenues[0], sampleVenues[1]]}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );

      expect(screen.getByTestId("comparison-drawer")).toBeInTheDocument();
      expect(screen.getByTestId("comparison-drawer-title")).toHaveTextContent(
        "Comparing 2 / 3 Venues",
      );

      expect(screen.getByTestId("mock-radar-chart")).toBeInTheDocument();
      expect(screen.getByTestId("radar-chart-labels")).toHaveTextContent(
        "WiFi,Quietness,Outlets,Seating,Coffee",
      );
      expect(
        screen.getByTestId("radar-series-Alpha Workspace"),
      ).toHaveTextContent("100,100,100,80,60");
    });

    it("renders radar chart and legend for 3 venues", () => {
      render(
        <ComparisonDrawer
          selectedVenues={sampleVenues}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );

      expect(screen.getByTestId("comparison-drawer-title")).toHaveTextContent(
        "Comparing 3 / 3 Venues",
      );

      expect(
        screen.getByTestId("radar-series-Alpha Workspace"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("radar-series-Beta Hub")).toBeInTheDocument();
      expect(
        screen.getByTestId("radar-series-Gamma Studio"),
      ).toBeInTheDocument();
    });
  });

  describe("Feature Table & Winner Highlights", () => {
    it("highlights the highest WiFi quality venue as winner", () => {
      render(
        <ComparisonDrawer
          selectedVenues={[sampleVenues[0], sampleVenues[1]]}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );

      const alphaWifiCell = screen.getByTestId(
        "comparison-cell-wifi-venue-alpha",
      );
      const betaWifiCell = screen.getByTestId(
        "comparison-cell-wifi-venue-beta",
      );

      expect(alphaWifiCell).toHaveTextContent("5 / 5");
      expect(alphaWifiCell).toHaveClass("bg-green-50");

      expect(betaWifiCell).toHaveTextContent("3 / 5");
      expect(betaWifiCell).not.toHaveClass("bg-green-50");
    });

    it("highlights venues with power outlets and displays check icon", () => {
      render(
        <ComparisonDrawer
          selectedVenues={[sampleVenues[0], sampleVenues[1]]}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );

      const alphaOutletCell = screen.getByTestId(
        "comparison-cell-outlets-venue-alpha",
      );
      const betaOutletCell = screen.getByTestId(
        "comparison-cell-outlets-venue-beta",
      );

      expect(
        screen.getByTestId("outlets-check-venue-alpha"),
      ).toBeInTheDocument();
      expect(alphaOutletCell).toHaveClass("bg-green-50");

      expect(betaOutletCell).toHaveTextContent("No");
      expect(betaOutletCell).not.toHaveClass("bg-green-50");
    });

    it("highlights quietest venue as noise winner", () => {
      render(
        <ComparisonDrawer
          selectedVenues={[sampleVenues[0], sampleVenues[1]]}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );

      const alphaNoiseCell = screen.getByTestId(
        "comparison-cell-noise-venue-alpha",
      );
      const betaNoiseCell = screen.getByTestId(
        "comparison-cell-noise-venue-beta",
      );

      expect(alphaNoiseCell).toHaveTextContent("quiet");
      expect(alphaNoiseCell).toHaveClass("bg-green-50");

      expect(betaNoiseCell).toHaveTextContent("moderate");
      expect(betaNoiseCell).not.toHaveClass("bg-green-50");
    });
  });

  describe("User Interactions & Dismissal", () => {
    it("calls onRemoveVenue with venue id when remove button is clicked", () => {
      render(
        <ComparisonDrawer
          selectedVenues={[sampleVenues[0], sampleVenues[1]]}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );

      const removeAlphaBtn = screen.getByTestId("remove-venue-venue-alpha-btn");
      expect(removeAlphaBtn).toHaveAttribute(
        "aria-label",
        "Remove Alpha Workspace from comparison",
      );

      fireEvent.click(removeAlphaBtn);
      expect(mockOnRemoveVenue).toHaveBeenCalledWith("venue-alpha");
    });

    it("renders and handles Clear Comparison button when onClearAll is provided", () => {
      render(
        <ComparisonDrawer
          selectedVenues={[sampleVenues[0], sampleVenues[1]]}
          onRemoveVenue={mockOnRemoveVenue}
          onClearAll={mockOnClearAll}
        />,
      );

      const clearBtn = screen.getByTestId("comparison-clear-all-btn");
      expect(clearBtn).toBeInTheDocument();

      fireEvent.click(clearBtn);
      expect(mockOnClearAll).toHaveBeenCalledTimes(1);
    });

    it("closes comparison when Escape key is pressed", () => {
      render(
        <ComparisonDrawer
          selectedVenues={[sampleVenues[0], sampleVenues[1]]}
          onRemoveVenue={mockOnRemoveVenue}
          onClose={mockOnClose}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Edge Case Handling", () => {
    it("safely handles venues with empty id or missing ratings without crashing", () => {
      const venuesWithEdgeCases: Venue[] = [
        {
          id: "",
          name: "Minimal Venue",
          address: "No Address",
          city: "Bengaluru",
          state: "Karnataka",
          zip: "560001",
          lat: 0,
          lng: 0,
          wifiQuality: null as any,
          hasOutlets: false,
          noiseLevel: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Venue,
        {
          id: "v-2",
          name: "Another Venue",
          address: "No Address",
          city: "Bengaluru",
          state: "Karnataka",
          zip: "560002",
          lat: 0,
          lng: 0,
          wifiQuality: undefined,
          hasOutlets: false,
          noiseLevel: "unknown" as any,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Venue,
      ];

      render(
        <ComparisonDrawer
          selectedVenues={venuesWithEdgeCases}
          onRemoveVenue={mockOnRemoveVenue}
        />,
      );

      expect(screen.getByTestId("comparison-drawer")).toBeInTheDocument();
      expect(screen.getAllByText("Minimal Venue").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Another Venue").length).toBeGreaterThanOrEqual(1);
    });
  });
});
