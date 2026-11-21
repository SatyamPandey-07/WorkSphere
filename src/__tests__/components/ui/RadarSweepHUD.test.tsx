import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RadarSweepHUD } from "../../../components/ui/RadarSweepHUD";

describe("RadarSweepHUD keyboard shortcuts and tooltips", () => {
  it("cycles radar range through 500m -> 1km -> 2km -> 5km -> 500m on pressing R", () => {
    const onRangeChange = jest.fn();
    render(<RadarSweepHUD initialRange={500} onRangeChange={onRangeChange} />);

    expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute(
      "data-range",
      "500",
    );

    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute(
      "data-range",
      "1000",
    );
    expect(onRangeChange).toHaveBeenLastCalledWith(1000);

    fireEvent.keyDown(window, { key: "R" });
    expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute(
      "data-range",
      "2000",
    );
    expect(onRangeChange).toHaveBeenLastCalledWith(2000);

    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute(
      "data-range",
      "5000",
    );
    expect(onRangeChange).toHaveBeenLastCalledWith(5000);

    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute(
      "data-range",
      "500",
    );
    expect(onRangeChange).toHaveBeenLastCalledWith(500);
  });

  it("toggles colleague tracking on pressing T", () => {
    const onToggleTracking = jest.fn();
    render(
      <RadarSweepHUD
        initialTrackingEnabled={false}
        onToggleTracking={onToggleTracking}
      />,
    );

    expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute(
      "data-tracking",
      "off",
    );

    fireEvent.keyDown(window, { key: "t" });
    expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute(
      "data-tracking",
      "on",
    );
    expect(onToggleTracking).toHaveBeenCalledWith(true);

    fireEvent.keyDown(window, { key: "T" });
    expect(screen.getByTestId("radar-sweep-hud")).toHaveAttribute(
      "data-tracking",
      "off",
    );
    expect(onToggleTracking).toHaveBeenCalledWith(false);
  });

  it("toggles HUD grid and telemetry overlay visibility on pressing H", () => {
    const onToggleHudOverlay = jest.fn();
    render(
      <RadarSweepHUD
        initialHudOverlayVisible={true}
        onToggleHudOverlay={onToggleHudOverlay}
      />,
    );

    expect(screen.getByTestId("radar-hud-overlay")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "h" });
    expect(screen.queryByTestId("radar-hud-overlay")).not.toBeInTheDocument();
    expect(onToggleHudOverlay).toHaveBeenCalledWith(false);

    fireEvent.keyDown(window, { key: "H" });
    expect(screen.getByTestId("radar-hud-overlay")).toBeInTheDocument();
    expect(onToggleHudOverlay).toHaveBeenCalledWith(true);
  });

  it("triggers Escape handler and calls onClose when provided", () => {
    const onClose = jest.fn();
    const onToggleHudOverlay = jest.fn();

    render(
      <RadarSweepHUD
        onClose={onClose}
        onToggleHudOverlay={onToggleHudOverlay}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onToggleHudOverlay).toHaveBeenCalledWith(false);
  });

  it("renders discoverable <kbd> badges inside control tooltips", () => {
    render(<RadarSweepHUD />);

    const tooltips = screen.getAllByRole("tooltip");
    const kbdLabels = tooltips.flatMap((tooltip) =>
      Array.from(tooltip.querySelectorAll("kbd")).map((el) => el.textContent),
    );

    expect(kbdLabels).toEqual(expect.arrayContaining(["R", "T", "H", "Esc"]));
  });

  it("ignores hotkeys when typing in input, textarea, or contentEditable elements", () => {
    const onRangeChange = jest.fn();
    const onToggleTracking = jest.fn();
    const onToggleHudOverlay = jest.fn();
    const onClose = jest.fn();

    render(
      <div>
        <input aria-label="Search input" />
        <textarea aria-label="Notes textarea" />
        <div contentEditable="true" aria-label="Rich editor" />
        <RadarSweepHUD
          onRangeChange={onRangeChange}
          onToggleTracking={onToggleTracking}
          onToggleHudOverlay={onToggleHudOverlay}
          onClose={onClose}
        />
      </div>,
    );

    const input = screen.getByLabelText("Search input");
    const textarea = screen.getByLabelText("Notes textarea");
    const editor = screen.getByLabelText("Rich editor");

    fireEvent.keyDown(input, { key: "r" });
    fireEvent.keyDown(textarea, { key: "t" });
    fireEvent.keyDown(editor, { key: "h" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onRangeChange).not.toHaveBeenCalled();
    expect(onToggleTracking).not.toHaveBeenCalled();
    expect(onToggleHudOverlay).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
