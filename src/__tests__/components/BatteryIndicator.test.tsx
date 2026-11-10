import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BatteryIndicator } from "@/components/p2p/BatteryIndicator";

describe("BatteryIndicator", () => {
  it("renders nothing without a valid reading", () => {
    const { container, rerender } = render(<BatteryIndicator percent={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BatteryIndicator percent={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BatteryIndicator percent={NaN} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [85, "good"],
    [51, "good"],
    [50, "medium"],
    [20, "medium"],
    [19, "low"],
    [0, "low"],
  ])("shows %i%% as %s", (percent, level) => {
    render(<BatteryIndicator percent={percent} />);
    const indicator = screen.getByTestId("battery-indicator");
    expect(indicator).toHaveAttribute("data-level", level);
    expect(indicator).toHaveTextContent(`${percent}%`);
    expect(indicator).toHaveAttribute(
      "aria-label",
      `Battery ${percent}%, ${level}`,
    );
  });

  it("uses green, amber and red colour classes", () => {
    const { rerender } = render(<BatteryIndicator percent={80} />);
    expect(screen.getByTestId("battery-indicator").className).toContain(
      "emerald",
    );
    rerender(<BatteryIndicator percent={35} />);
    expect(screen.getByTestId("battery-indicator").className).toContain(
      "amber",
    );
    rerender(<BatteryIndicator percent={10} />);
    expect(screen.getByTestId("battery-indicator").className).toContain("rose");
  });
});
