import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DistanceFilterSlider } from "@/components/venues/DistanceFilterSlider";

describe("DistanceFilterSlider double-click reset (#5026)", () => {
  it("resets distance value to default 10km when double-clicking the slider input", () => {
    const onChange = jest.fn();

    render(<DistanceFilterSlider value={25} onChange={onChange} />);

    const slider = screen.getByTestId("distance-slider");
    expect(slider).toHaveValue("25");

    fireEvent.doubleClick(slider);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("resets distance value to default 10km when double-clicking the slider track container", () => {
    const onChange = jest.fn();

    render(<DistanceFilterSlider value={40} onChange={onChange} />);

    const trackContainer = screen.getByTestId("distance-slider-track");
    fireEvent.doubleClick(trackContainer);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("resets distance value when double-clicking the outer slider container", () => {
    const onChange = jest.fn();

    render(<DistanceFilterSlider value={5} onChange={onChange} />);

    const container = screen.getByTestId("distance-slider-container");
    fireEvent.doubleClick(container);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("honors custom defaultValue prop on double-click", () => {
    const onChange = jest.fn();

    render(
      <DistanceFilterSlider
        value={50}
        defaultValue={15}
        onChange={onChange}
      />,
    );

    const slider = screen.getByTestId("distance-slider");
    fireEvent.doubleClick(slider);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(15);
  });
});
