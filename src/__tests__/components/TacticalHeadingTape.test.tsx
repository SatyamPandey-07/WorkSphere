import React from "react";
import { render, screen, act } from "@testing-library/react";
import { TacticalHeadingTape } from "@/components/ar/TacticalHeadingTape";

describe("TacticalHeadingTape Component", () => {
  beforeEach(() => {
    (window as any).DeviceOrientationEvent = Event;
  });

  afterEach(() => {
    delete (window as any).DeviceOrientationEvent;
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  it("renders heading tape with default target bearing and calibrated HUD display", () => {
    render(<TacticalHeadingTape externalHeading={90} targetBearing={180} />);

    expect(screen.getByTestId("tactical-heading-tape")).toBeInTheDocument();
    expect(screen.getByText(/HDG: 90°/i)).toBeInTheDocument();
    expect(screen.getByText(/180°/i)).toBeInTheDocument();
    expect(screen.getByTestId("target-bearing-bug")).toBeInTheDocument();
  });

  it("sanitizes NaN and negative externalHeading inputs gracefully", () => {
    const { rerender } = render(
      <TacticalHeadingTape externalHeading={NaN} targetBearing={NaN} />,
    );

    expect(screen.getByText(/HDG: 0°/i)).toBeInTheDocument();
    expect(screen.getByText(/135°/i)).toBeInTheDocument();

    // Rerender with valid negative heading normalized to 360
    rerender(<TacticalHeadingTape externalHeading={-90} targetBearing={-45} />);
    expect(screen.getByText(/HDG: (270|342)°/i)).toBeInTheDocument();
    expect(screen.getByText(/315°/i)).toBeInTheDocument();
  });

  it("smoothly updates heading when externalHeading changes", () => {
    const { rerender } = render(<TacticalHeadingTape externalHeading={100} />);
    expect(screen.getByText(/HDG: 100°/i)).toBeInTheDocument();

    rerender(<TacticalHeadingTape externalHeading={150} />);
    // Lerp smoothing updates toward target
    expect(screen.getByText(/HDG: (110|150)°/i)).toBeInTheDocument();
  });

  it("handles deviceorientation events with webkitCompassHeading and alpha", () => {
    const onHeadingUpdate = jest.fn();
    render(<TacticalHeadingTape onHeadingUpdate={onHeadingUpdate} />);

    // Simulate device orientation event with webkitCompassHeading
    act(() => {
      const event = new Event("deviceorientation") as any;
      event.webkitCompassHeading = 210;
      window.dispatchEvent(event);
    });

    expect(onHeadingUpdate).toHaveBeenCalled();
    expect(screen.getByText(/MAG CALIBRATED/i)).toBeInTheDocument();

    // Simulate standard alpha orientation
    act(() => {
      const event = new Event("deviceorientation") as any;
      event.webkitCompassHeading = undefined;
      event.alpha = 60;
      window.dispatchEvent(event);
    });

    expect(onHeadingUpdate).toHaveBeenCalled();
  });

  it("ignores non-finite deviceorientation alpha values", () => {
    const onHeadingUpdate = jest.fn();
    render(<TacticalHeadingTape externalHeading={0} onHeadingUpdate={onHeadingUpdate} />);

    act(() => {
      const event = new Event("deviceorientation") as any;
      event.webkitCompassHeading = NaN;
      event.alpha = NaN;
      window.dispatchEvent(event);
    });

    expect(screen.getByText(/HDG: 0°/i)).toBeInTheDocument();
  });
});
