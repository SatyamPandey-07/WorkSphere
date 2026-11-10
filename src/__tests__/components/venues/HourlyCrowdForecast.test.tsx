import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultHourlyCrowdForecast, {
  HourlyCrowdForecast,
  getCrowdGradient,
  getDecibelVibeTag,
  getTooltipAlignment,
  DecibelThresholdTooltip,
} from "@/components/venues/HourlyCrowdForecast";
import { VenueDetailModal } from "@/components/venues/VenueDetailModal";

describe("HourlyCrowdForecast Component", () => {
  it("renders with default 24-hour bars", () => {
    render(<HourlyCrowdForecast venueId="v1" venueName="Test Cafe" />);

    expect(screen.getByTestId("hourly-crowd-forecast")).toBeInTheDocument();
    expect(screen.getByTestId("crowd-timeline-slider")).toBeInTheDocument();
    expect(screen.getByTestId("hourly-bars-container")).toBeInTheDocument();
  });

  it("updates selected hour and metrics when scrubbing timeline slider", () => {
    const onHourChange = jest.fn();
    render(
      <HourlyCrowdForecast
        venueId="v1"
        onHourChange={onHourChange}
      />
    );

    const slider = screen.getByTestId("crowd-timeline-slider");
    fireEvent.change(slider, { target: { value: "14" } });

    expect(onHourChange).toHaveBeenCalledWith(14);
    expect(screen.getByTestId("selected-hour-label")).toHaveTextContent("2:00 PM");
  });

  it("highlights current hour with live indicator when selected", () => {
    render(<HourlyCrowdForecast venueId="v1" />);

    // By default, selectedHour is currentHour
    expect(screen.getByTestId("live-indicator-badge")).toBeInTheDocument();
    expect(screen.getByTestId("live-indicator-badge")).toHaveTextContent("LIVE");
  });

  it("computes fluid gradient styles correctly based on crowd density", () => {
    const quiet = getCrowdGradient(25);
    expect(quiet.label).toBe("Quiet");
    expect(quiet.barClass).toContain("from-blue-600");

    const moderate = getCrowdGradient(60);
    expect(moderate.label).toBe("Moderate");
    expect(moderate.barClass).toContain("from-purple-600");

    const packed = getCrowdGradient(85);
    expect(packed.label).toBe("Packed");
    expect(packed.barClass).toContain("from-pink-600");
  });

  it("displays floating decibel threshold tooltip on bar hover with required metrics", () => {
    render(<HourlyCrowdForecast venueId="v1" />);

    // Initially, no tooltip is shown
    expect(screen.queryByTestId("decibel-threshold-tooltip")).not.toBeInTheDocument();

    // Hover over bar for hour 2 (quiet early morning)
    const bar2 = screen.getByTestId("hourly-bar-2");
    fireEvent.mouseEnter(bar2);

    const tooltip = screen.getByTestId("decibel-threshold-tooltip");
    expect(tooltip).toBeInTheDocument();

    // Verify expected metrics: Expected dBA, Historical noise variance (+/- 4 dB), Vibe tag
    const expectedDba = screen.getByTestId("tooltip-expected-dba");
    expect(expectedDba).toBeInTheDocument();
    expect(expectedDba.textContent).toMatch(/\d+\s*dBA/);

    const variance = screen.getByTestId("tooltip-noise-variance");
    expect(variance).toBeInTheDocument();
    expect(variance.textContent).toContain("+/- 4 dB");

    const vibeTag = screen.getByTestId("tooltip-vibe-tag");
    expect(vibeTag).toBeInTheDocument();
    expect(vibeTag.textContent).toContain("Quiet Library");

    // Hide tooltip on mouse leave
    fireEvent.mouseLeave(bar2);
    const container = screen.getByTestId("hourly-bars-container");
    fireEvent.mouseLeave(container);
    expect(screen.queryByTestId("decibel-threshold-tooltip")).not.toBeInTheDocument();
  });

  it("displays Bustling Cafe vibe tag for high-decibel hours", () => {
    const customForecast = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      crowdPercentage: 90,
      noiseLevel: "loud" as const,
      decibels: 72,
    }));

    render(<HourlyCrowdForecast venueId="v1" forecast={customForecast} />);

    const bar12 = screen.getByTestId("hourly-bar-12");
    fireEvent.mouseEnter(bar12);

    const vibeTag = screen.getByTestId("tooltip-vibe-tag");
    expect(vibeTag.textContent).toContain("Bustling Cafe");

    const expectedDba = screen.getByTestId("tooltip-expected-dba");
    expect(expectedDba.textContent).toBe("72 dBA");
  });

  it("positions tooltips with boundary detection to prevent screen edge overflow", () => {
    render(<HourlyCrowdForecast venueId="v1" />);

    // Index 0 (far left) should have left boundary alignment
    const bar0 = screen.getByTestId("hourly-bar-0");
    fireEvent.mouseEnter(bar0);
    let tooltip = screen.getByTestId("decibel-threshold-tooltip");
    expect(tooltip).toHaveAttribute("data-alignment", "left");

    // Index 23 (far right) should have right boundary alignment
    const bar23 = screen.getByTestId("hourly-bar-23");
    fireEvent.mouseEnter(bar23);
    tooltip = screen.getByTestId("decibel-threshold-tooltip");
    expect(tooltip).toHaveAttribute("data-alignment", "right");

    // Index 12 (middle) should have center alignment
    const bar12 = screen.getByTestId("hourly-bar-12");
    fireEvent.mouseEnter(bar12);
    tooltip = screen.getByTestId("decibel-threshold-tooltip");
    expect(tooltip).toHaveAttribute("data-alignment", "center");
  });

  it("correctly calculates tooltip boundary alignment via getTooltipAlignment", () => {
    expect(getTooltipAlignment(0)).toBe("left");
    expect(getTooltipAlignment(1)).toBe("left");
    expect(getTooltipAlignment(3)).toBe("left");
    expect(getTooltipAlignment(4)).toBe("center");
    expect(getTooltipAlignment(12)).toBe("center");
    expect(getTooltipAlignment(19)).toBe("center");
    expect(getTooltipAlignment(20)).toBe("right");
    expect(getTooltipAlignment(23)).toBe("right");
  });

  it("maps decibel levels and noise categories to acoustic vibe tags correctly", () => {
    expect(getDecibelVibeTag(35, "quiet")).toBe("Quiet Library");
    expect(getDecibelVibeTag(45)).toBe("Quiet Library");
    expect(getDecibelVibeTag(56, "moderate")).toBe("Cozy Workspace");
    expect(getDecibelVibeTag(70, "loud")).toBe("Bustling Cafe");
    expect(getDecibelVibeTag(68)).toBe("Bustling Cafe");
  });
});

describe("VenueDetailModal Component", () => {
  it("exports VenueDetailModal correctly", () => {
    expect(VenueDetailModal).toBeDefined();
  });
});
