import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  CockpitAltimeterTape,
  calculateAltitudeFeet,
  interpolateAltitudeDrumPosition,
  playAvionicsTickSound,
} from "@/components/hud/CockpitAltimeterTape";

describe("calculateAltitudeFeet", () => {
  it("returns 0 for ground or negative floors", () => {
    expect(calculateAltitudeFeet(0, 10)).toBe(0);
    expect(calculateAltitudeFeet(-2, 10)).toBe(0);
    expect(calculateAltitudeFeet(NaN as any, 10)).toBe(0);
  });

  it("calculates calibrated altitude for standard floors", () => {
    expect(calculateAltitudeFeet(1, 10)).toBe(1000);
    expect(calculateAltitudeFeet(4, 10)).toBe(4000);
    expect(calculateAltitudeFeet(7, 10)).toBe(7000);
  });

  it("caps at 10000 ft for rooftop floors", () => {
    expect(calculateAltitudeFeet(10, 10)).toBe(10000);
    expect(calculateAltitudeFeet(15, 10)).toBe(10000);
  });

  it("handles non-finite totalFloors safely", () => {
    expect(calculateAltitudeFeet(2, 0)).toBe(2000);
    expect(calculateAltitudeFeet(2, -5)).toBe(2000);
    expect(calculateAltitudeFeet(2, NaN as any)).toBe(2000);
  });
});

describe("interpolateAltitudeDrumPosition", () => {
  it("interpolates drum position linearly across travel distance", () => {
    expect(interpolateAltitudeDrumPosition(0, 10000, 320)).toBe(0);
    expect(interpolateAltitudeDrumPosition(5000, 10000, 320)).toBe(160);
    expect(interpolateAltitudeDrumPosition(10000, 10000, 320)).toBe(320);
  });

  it("clamps altitude exceeding max boundaries", () => {
    expect(interpolateAltitudeDrumPosition(15000, 10000, 320)).toBe(320);
    expect(interpolateAltitudeDrumPosition(-500, 10000, 320)).toBe(0);
  });

  it("handles fallback defaults on zero or invalid dimensions", () => {
    expect(interpolateAltitudeDrumPosition(5000, 0, 0)).toBe(160);
    expect(interpolateAltitudeDrumPosition(NaN as any, 10000, 320)).toBe(0);
  });
});

describe("playAvionicsTickSound", () => {
  it("runs without throwing in any environment", () => {
    expect(() => playAvionicsTickSound()).not.toThrow();
  });
});

describe("CockpitAltimeterTape Component", () => {
  it("renders ground level state correctly", () => {
    render(<CockpitAltimeterTape floorNumber={0} totalFloors={5} venueName="CyberHub One" />);

    expect(screen.getByTestId("cockpit-altimeter-tape")).toBeInTheDocument();
    expect(screen.getByTestId("altimeter-venue-name")).toHaveTextContent("CyberHub One");
    expect(screen.getByTestId("altimeter-active-level")).toHaveTextContent("GND");
    expect(screen.getByTestId("altimeter-level-description")).toHaveTextContent("Ground Level / 0 FT");
    expect(screen.getByTestId("altimeter-elevation-footer")).toHaveTextContent("0 FT");
  });

  it("renders standard floor state correctly", () => {
    render(<CockpitAltimeterTape floorNumber={3} totalFloors={8} venueName="Skyline Tower" />);

    expect(screen.getByTestId("altimeter-active-level")).toHaveTextContent("F3");
    expect(screen.getByTestId("altimeter-level-description")).toHaveTextContent("Floor 3 Active");
    expect(screen.getByTestId("altimeter-elevation-footer")).toHaveTextContent("3,000 FT");
  });

  it("renders rooftop sky deck state correctly", () => {
    render(<CockpitAltimeterTape floorNumber={8} totalFloors={8} venueName="Apex Lounge" />);

    expect(screen.getByTestId("altimeter-active-level")).toHaveTextContent("ROOF");
    expect(screen.getByTestId("altimeter-level-description")).toHaveTextContent("Sky Deck / 10,000 FT");
    expect(screen.getByTestId("altimeter-elevation-footer")).toHaveTextContent("10,000 FT");
  });

  it("triggers onFloorChange callbacks when ascend and descend stepper buttons are clicked", () => {
    const handleFloorChange = jest.fn();
    render(
      <CockpitAltimeterTape
        floorNumber={4}
        totalFloors={10}
        onFloorChange={handleFloorChange}
      />
    );

    const ascendBtn = screen.getByTestId("altimeter-ascend-btn");
    const descendBtn = screen.getByTestId("altimeter-descend-btn");

    expect(ascendBtn).not.toBeDisabled();
    expect(descendBtn).not.toBeDisabled();

    fireEvent.click(ascendBtn);
    expect(handleFloorChange).toHaveBeenCalledWith(5);

    fireEvent.click(descendBtn);
    expect(handleFloorChange).toHaveBeenCalledWith(3);
  });

  it("disables ascend button at top floor and descend button at first floor", () => {
    const handleFloorChange = jest.fn();
    const { rerender } = render(
      <CockpitAltimeterTape
        floorNumber={10}
        totalFloors={10}
        onFloorChange={handleFloorChange}
      />
    );

    expect(screen.getByTestId("altimeter-ascend-btn")).toBeDisabled();
    expect(screen.getByTestId("altimeter-descend-btn")).not.toBeDisabled();

    rerender(
      <CockpitAltimeterTape
        floorNumber={1}
        totalFloors={10}
        onFloorChange={handleFloorChange}
      />
    );

    expect(screen.getByTestId("altimeter-ascend-btn")).not.toBeDisabled();
    expect(screen.getByTestId("altimeter-descend-btn")).toBeDisabled();
  });

  it("merges custom className on root element", () => {
    render(
      <CockpitAltimeterTape
        floorNumber={2}
        totalFloors={6}
        className="custom-hud-altimeter-class"
      />
    );

    expect(screen.getByTestId("cockpit-altimeter-tape").className).toContain(
      "custom-hud-altimeter-class"
    );
  });
});
