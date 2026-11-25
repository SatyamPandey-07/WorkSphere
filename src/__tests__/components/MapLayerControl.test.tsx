/// <reference types="jest" />
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import MapLayerControl, { MAP_LAYER_FOCUS_RING } from "@/components/map/MapLayerControl";

const FOCUS_CLASSES = [
  "focus-visible:ring-2",
  "focus-visible:ring-blue-500",
  "focus-visible:ring-offset-2",
  "focus-visible:ring-offset-zinc-900",
];

const LABELS = [
  "Seating Occupancy Heatmap",
  "Ambient Noise Contours",
  "Power Outlet Availability Pins",
];

describe("MapLayerControl focus ring and aria-pressed (#7724)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders every layer as a native toggle button inside a labelled group", () => {
    render(<MapLayerControl />);
    const group = screen.getByRole("group", { name: "Map layers" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(LABELS);
    buttons.forEach((b) => {
      expect(b.tagName).toBe("BUTTON");
      expect(b).toHaveAttribute("type", "button");
      expect(b).not.toHaveAttribute("tabindex", "-1");
    });
  });

  it("gives every toggle the high-contrast two-tone focus ring classes", () => {
    render(<MapLayerControl />);
    for (const label of LABELS) {
      const button = screen.getByRole("button", { name: label });
      FOCUS_CLASSES.forEach((cls) => expect(button).toHaveClass(cls));
      expect(button).toHaveClass("focus-visible:outline-none");
    }
    FOCUS_CLASSES.forEach((cls) => expect(MAP_LAYER_FOCUS_RING).toContain(cls));
  });

  it("exposes the saved layer state through aria-pressed", () => {
    render(<MapLayerControl />);
    expect(screen.getByRole("button", { name: LABELS[0] })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: LABELS[1] })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: LABELS[2] })).toHaveAttribute("aria-pressed", "true");
  });

  it("updates aria-pressed when a layer is switched on and off", () => {
    render(<MapLayerControl />);
    const noise = screen.getByRole("button", { name: LABELS[1] });

    fireEvent.click(noise);
    expect(noise).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(noise);
    expect(noise).toHaveAttribute("aria-pressed", "false");

    // Toggling one layer never changes the others.
    expect(screen.getByRole("button", { name: LABELS[0] })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: LABELS[2] })).toHaveAttribute("aria-pressed", "true");
  });

  it("restores aria-pressed from stored preferences", () => {
    localStorage.setItem(
      "map_layer_preferences_v1",
      JSON.stringify({ seatingHeatmap: false, noiseContours: true, powerOutlets: false }),
    );
    render(<MapLayerControl />);
    expect(screen.getByRole("button", { name: LABELS[0] })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: LABELS[1] })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: LABELS[2] })).toHaveAttribute("aria-pressed", "false");
  });

  it("persists a toggle to localStorage", () => {
    render(<MapLayerControl />);
    fireEvent.click(screen.getByRole("button", { name: LABELS[1] }));
    expect(JSON.parse(localStorage.getItem("map_layer_preferences_v1") as string)).toMatchObject({
      noiseContours: true,
    });
  });

  it("is reachable by keyboard focus", () => {
    render(<MapLayerControl />);
    const first = screen.getByRole("button", { name: LABELS[0] });
    first.focus();
    expect(first).toHaveFocus();
  });
});
