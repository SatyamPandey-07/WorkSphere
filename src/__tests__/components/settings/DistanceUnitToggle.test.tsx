import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DistanceUnitToggle } from "@/components/settings/DistanceUnitToggle";
import { DISTANCE_UNIT_STORAGE_KEY } from "@/lib/geo/formatDistance";

describe("DistanceUnitToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders with stored METRIC preference and accessible elements", () => {
    localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, "METRIC");

    render(<DistanceUnitToggle />);

    const container = screen.getByTestId("distance-unit-toggle");
    expect(container).toBeInTheDocument();
    expect(screen.getByText("Distance Units")).toBeInTheDocument();

    const metricBtn = screen.getByTestId("distance-unit-metric");
    const imperialBtn = screen.getByTestId("distance-unit-imperial");

    expect(metricBtn).toHaveAttribute("aria-pressed", "true");
    expect(imperialBtn).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("distance-unit-metric-check")).toBeInTheDocument();
    expect(screen.queryByTestId("distance-unit-imperial-check")).not.toBeInTheDocument();

    const chip = screen.getByTestId("distance-preview-chip");
    expect(chip).toHaveTextContent("1.5 km ≈ 0.93 mi");
  });

  it("initializes with stored IMPERIAL preference from localStorage", () => {
    localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, "IMPERIAL");

    render(<DistanceUnitToggle />);

    const metricBtn = screen.getByTestId("distance-unit-metric");
    const imperialBtn = screen.getByTestId("distance-unit-imperial");

    expect(metricBtn).toHaveAttribute("aria-pressed", "false");
    expect(imperialBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("distance-unit-imperial-check")).toBeInTheDocument();
    expect(screen.queryByTestId("distance-unit-metric-check")).not.toBeInTheDocument();

    const chip = screen.getByTestId("distance-preview-chip");
    expect(chip).toHaveTextContent("1.0 mi ≈ 1.61 km");
  });

  it("switches to IMPERIAL on click, calls onUnitChange, and updates localStorage", () => {
    localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, "METRIC");
    const handleUnitChange = jest.fn();
    render(<DistanceUnitToggle onUnitChange={handleUnitChange} />);

    const imperialBtn = screen.getByTestId("distance-unit-imperial");
    fireEvent.click(imperialBtn);

    expect(imperialBtn).toHaveAttribute("aria-pressed", "true");
    expect(handleUnitChange).toHaveBeenCalledWith("IMPERIAL");
    expect(localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY)).toBe("IMPERIAL");
    expect(screen.getByTestId("distance-preview-chip")).toHaveTextContent("1.0 mi ≈ 1.61 km");
  });

  it("switches back to METRIC on click, calls onUnitChange, and updates localStorage", () => {
    localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, "IMPERIAL");
    const handleUnitChange = jest.fn();
    render(<DistanceUnitToggle onUnitChange={handleUnitChange} />);

    const metricBtn = screen.getByTestId("distance-unit-metric");
    fireEvent.click(metricBtn);

    expect(metricBtn).toHaveAttribute("aria-pressed", "true");
    expect(handleUnitChange).toHaveBeenCalledWith("METRIC");
    expect(localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY)).toBe("METRIC");
    expect(screen.getByTestId("distance-preview-chip")).toHaveTextContent("1.5 km ≈ 0.93 mi");
  });

  it("reacts to external worksphere_distance_unit_change event", () => {
    const handleUnitChange = jest.fn();
    render(<DistanceUnitToggle onUnitChange={handleUnitChange} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("worksphere_distance_unit_change", { detail: "IMPERIAL" }),
      );
    });

    const imperialBtn = screen.getByTestId("distance-unit-imperial");
    expect(imperialBtn).toHaveAttribute("aria-pressed", "true");
    expect(handleUnitChange).toHaveBeenCalledWith("IMPERIAL");
  });

  it("removes event listener on unmount", () => {
    const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = render(<DistanceUnitToggle />);

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "worksphere_distance_unit_change",
      expect.any(Function),
    );
  });

  it("merges custom className with container", () => {
    render(<DistanceUnitToggle className="custom-distance-toggle-class" />);
    const container = screen.getByTestId("distance-unit-toggle");
    expect(container).toHaveClass("custom-distance-toggle-class");
  });
});
