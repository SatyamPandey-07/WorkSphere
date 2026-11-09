import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultHourlyCrowdForecast, {
  HourlyCrowdForecast,
  getCrowdGradient,
} from "@/components/venues/HourlyCrowdForecast";
import { VenueDetailModal } from "@/components/venues/VenueDetailModal";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => any;
declare const beforeEach: (fn: () => void) => void;
declare const jest: any;

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
    const currentHour = new Date().getHours();
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
});

describe("VenueDetailModal Component", () => {
  it("exports VenueDetailModal correctly", () => {
    expect(VenueDetailModal).toBeDefined();
  });
});
