import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DistanceFilterSlider } from "@/components/venues/DistanceFilterSlider";

describe("DistanceFilterSlider", () => {
  const onChange = jest.fn();
  const onLocationDetected = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders with given distance value and displays readout", () => {
    render(<DistanceFilterSlider value={15} onChange={onChange} />);

    expect(screen.getByTestId("distance-filter-slider-container")).toBeInTheDocument();
    expect(screen.getByTestId("distance-readout")).toHaveTextContent("15 km");
    expect(screen.getByTestId("reset-distance-btn")).toBeInTheDocument();
  });

  it("renders 'Any Distance' when value is 0", () => {
    render(<DistanceFilterSlider value={0} onChange={onChange} />);

    expect(screen.getByTestId("distance-readout")).toHaveTextContent("Any Distance");
    expect(screen.queryByTestId("reset-distance-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("preset-distance-any")).toHaveClass("bg-blue-600");
  });

  it("commits immediate change on preset click", () => {
    render(<DistanceFilterSlider value={10} onChange={onChange} />);

    const preset25 = screen.getByTestId("preset-distance-25");
    fireEvent.click(preset25);

    expect(onChange).toHaveBeenCalledWith(25);
    expect(screen.getByTestId("distance-readout")).toHaveTextContent("25 km");
  });

  it("commits immediate change to 0 when reset button is clicked", () => {
    render(<DistanceFilterSlider value={20} onChange={onChange} />);

    const resetBtn = screen.getByTestId("reset-distance-btn");
    fireEvent.click(resetBtn);

    expect(onChange).toHaveBeenCalledWith(0);
    expect(screen.getByTestId("distance-readout")).toHaveTextContent("Any Distance");
  });

  it("resets to defaultValue on double click of slider container", () => {
    render(<DistanceFilterSlider value={30} defaultValue={10} onChange={onChange} />);

    const sliderContainer = screen.getByTestId("distance-slider-container");
    fireEvent.doubleClick(sliderContainer);

    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("debounces slider input changes and calls onChange after debounceMs", () => {
    render(<DistanceFilterSlider value={10} onChange={onChange} debounceMs={200} />);

    const slider = screen.getByTestId("distance-slider");
    fireEvent.change(slider, { target: { value: "35" } });

    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(onChange).toHaveBeenCalledWith(35);
  });

  it("commits immediately on slider pointerUp", () => {
    render(<DistanceFilterSlider value={10} onChange={onChange} debounceMs={500} />);

    const slider = screen.getByTestId("distance-slider");
    fireEvent.change(slider, { target: { value: "40" } });
    fireEvent.pointerUp(slider);

    expect(onChange).toHaveBeenCalledWith(40);
  });

  it("requests geolocation when button is clicked and reports location", () => {
    const mockGeolocation = {
      getCurrentPosition: jest.fn((success) =>
        success({
          coords: {
            latitude: 37.7749,
            longitude: -122.4194,
          },
        }),
      ),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
    });

    render(
      <DistanceFilterSlider
        value={10}
        onChange={onChange}
        onLocationDetected={onLocationDetected}
      />,
    );

    const locateBtn = screen.getByTestId("get-current-location-btn");
    fireEvent.click(locateBtn);

    expect(mockGeolocation.getCurrentPosition).toHaveBeenCalled();
    expect(onLocationDetected).toHaveBeenCalledWith({
      lat: 37.7749,
      lng: -122.4194,
    });
    expect(screen.getByText(/Active Location: \(37.775, -122.419\)/)).toBeInTheDocument();
  });

  it("handles geolocation error gracefully", () => {
    const mockGeolocation = {
      getCurrentPosition: jest.fn((_, error) =>
        error({
          code: 1, // PERMISSION_DENIED
          PERMISSION_DENIED: 1,
        }),
      ),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
    });

    render(<DistanceFilterSlider value={10} onChange={onChange} />);

    const locateBtn = screen.getByTestId("get-current-location-btn");
    fireEvent.click(locateBtn);

    expect(screen.getByTestId("distance-geo-error")).toHaveTextContent(
      "Location permission denied",
    );
  });

  it("handles non-array or undefined presets gracefully", () => {
    render(
      <DistanceFilterSlider
        value={10}
        presets={undefined as unknown as number[]}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId("preset-distance-5")).toBeInTheDocument();
    expect(screen.getByTestId("preset-distance-50")).toBeInTheDocument();
  });

  it("merges custom className with container", () => {
    render(
      <DistanceFilterSlider
        value={10}
        onChange={onChange}
        className="custom-distance-slider-class"
      />,
    );

    expect(screen.getByTestId("distance-filter-slider-container")).toHaveClass(
      "custom-distance-slider-class",
    );
  });
});
