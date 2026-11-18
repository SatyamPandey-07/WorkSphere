import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DualRangeSlider } from "@/components/ui/DualRangeSlider";

describe("DualRangeSlider Component", () => {
  it("renders with accessible ARIA slider attributes", () => {
    render(
      <DualRangeSlider
        min={0}
        max={100}
        value={[20, 80]}
        minThumbLabel="Minimum decibels"
        maxThumbLabel="Maximum decibels"
        formatValue={(v) => `${v} dB`}
        label="Ambient Noise"
      />,
    );

    expect(screen.getByTestId("dual-range-slider")).toBeInTheDocument();
    expect(screen.getByTestId("dual-range-track-container")).toBeInTheDocument();
    expect(screen.getByTestId("dual-range-track-highlight")).toBeInTheDocument();

    const minThumb = screen.getByTestId("dual-range-thumb-min");
    const maxThumb = screen.getByTestId("dual-range-thumb-max");

    expect(minThumb).toHaveAttribute("role", "slider");
    expect(minThumb).toHaveAttribute("aria-valuemin", "0");
    expect(minThumb).toHaveAttribute("aria-valuenow", "20");
    expect(minThumb).toHaveAttribute("aria-valuetext", "20 dB");
    expect(minThumb).toHaveAttribute("aria-label", "Minimum decibels");

    expect(maxThumb).toHaveAttribute("role", "slider");
    expect(maxThumb).toHaveAttribute("aria-valuemax", "100");
    expect(maxThumb).toHaveAttribute("aria-valuenow", "80");
    expect(maxThumb).toHaveAttribute("aria-valuetext", "80 dB");
    expect(maxThumb).toHaveAttribute("aria-label", "Maximum decibels");
  });

  it("renders active track highlight between minimum and maximum thumb coordinates", () => {
    render(
      <DualRangeSlider
        min={0}
        max={100}
        value={[25, 75]}
      />,
    );

    const highlight = screen.getByTestId("dual-range-track-highlight");
    expect(highlight).toHaveStyle({
      left: "25%",
      width: "50%",
    });
  });

  it("supports keyboard fine-tuning with Arrow keys (step: 1)", () => {
    const onChange = jest.fn();
    render(
      <DualRangeSlider
        min={0}
        max={100}
        step={1}
        value={[30, 70]}
        onChange={onChange}
      />,
    );

    const minThumb = screen.getByTestId("dual-range-thumb-min");

    // ArrowRight: increment by 1
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith([31, 70]);

    // ArrowLeft: decrement by 1
    fireEvent.keyDown(minThumb, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith([29, 70]);
  });

  it("supports keyboard coarse-tuning with PageUp / PageDown keys (step: 10)", () => {
    const onChange = jest.fn();
    render(
      <DualRangeSlider
        min={0}
        max={100}
        step={1}
        value={[40, 80]}
        onChange={onChange}
      />,
    );

    const minThumb = screen.getByTestId("dual-range-thumb-min");
    const maxThumb = screen.getByTestId("dual-range-thumb-max");

    // PageUp on minThumb: increment by 10
    fireEvent.keyDown(minThumb, { key: "PageUp" });
    expect(onChange).toHaveBeenCalledWith([50, 80]);

    // PageDown on minThumb: decrement by 10
    fireEvent.keyDown(minThumb, { key: "PageDown" });
    expect(onChange).toHaveBeenCalledWith([30, 80]);

    // PageDown on maxThumb: decrement by 10
    fireEvent.keyDown(maxThumb, { key: "PageDown" });
    expect(onChange).toHaveBeenCalledWith([40, 70]);

    // PageUp on maxThumb: increment by 10
    fireEvent.keyDown(maxThumb, { key: "PageUp" });
    expect(onChange).toHaveBeenCalledWith([40, 90]);
  });

  it("handles Home and End keys for jumping to boundaries", () => {
    const onChange = jest.fn();
    render(
      <DualRangeSlider
        min={0}
        max={100}
        value={[30, 70]}
        onChange={onChange}
      />,
    );

    const minThumb = screen.getByTestId("dual-range-thumb-min");
    const maxThumb = screen.getByTestId("dual-range-thumb-max");

    // Home on minThumb: jump to min (0)
    fireEvent.keyDown(minThumb, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith([0, 70]);

    // End on maxThumb: jump to max (100)
    fireEvent.keyDown(maxThumb, { key: "End" });
    expect(onChange).toHaveBeenCalledWith([30, 100]);
  });

  it("respects minDistance constraint between thumbs", () => {
    const onChange = jest.fn();
    render(
      <DualRangeSlider
        min={0}
        max={100}
        step={1}
        minDistance={10}
        value={[50, 60]}
        onChange={onChange}
      />,
    );

    const minThumb = screen.getByTestId("dual-range-thumb-min");

    // Attempt to push min thumb closer than minDistance
    fireEvent.keyDown(minThumb, { key: "PageUp" });
    // Should be clamped to maxVal - minDistance = 60 - 10 = 50
    expect(onChange).toHaveBeenCalledWith([50, 60]);
  });

  it("handles pointer down and dragging across track", () => {
    const onChange = jest.fn();
    const onChangeEnd = jest.fn();
    render(
      <DualRangeSlider
        min={0}
        max={100}
        value={[20, 80]}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />,
    );

    const trackContainer = screen.getByTestId("dual-range-track-container");
    jest.spyOn(trackContainer, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      bottom: 20,
      right: 200,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Pointer down at x = 30px (closer to min = 20% = 40px)
    fireEvent.pointerDown(trackContainer, { clientX: 30, pointerId: 1 });
    expect(onChange).toHaveBeenCalled();

    // Pointer move to x = 50px (ratio = 0.25 -> value = 25)
    fireEvent.pointerMove(trackContainer, { clientX: 50, pointerId: 1 });
    expect(onChange).toHaveBeenCalled();

    // Pointer up
    fireEvent.pointerUp(trackContainer, { pointerId: 1 });
    expect(onChangeEnd).toHaveBeenCalled();
  });

  it("supports touch events for mobile touch dragging", () => {
    const onChange = jest.fn();
    render(
      <DualRangeSlider
        min={0}
        max={100}
        value={[20, 80]}
        onChange={onChange}
      />,
    );

    const trackContainer = screen.getByTestId("dual-range-track-container");
    jest.spyOn(trackContainer, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 100,
      top: 0,
      bottom: 20,
      right: 100,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.pointerDown(trackContainer, { clientX: 10, pointerId: 1 });
    fireEvent.touchMove(trackContainer, {
      touches: [{ clientX: 35 } as any],
    });
    expect(onChange).toHaveBeenCalled();

    fireEvent.touchEnd(trackContainer);
  });
});
