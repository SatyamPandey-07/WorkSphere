/** @jest-environment jsdom */

import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AccentPicker } from "@/components/AccentPicker";

describe("AccentPicker with Lantern Emerald (#6164)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
  });

  it("renders 5 accent color radio buttons including Lantern Emerald", () => {
    render(
      <ThemeProvider initialAccent="blue">
        <AccentPicker />
      </ThemeProvider>,
    );

    const radioButtons = screen.getAllByRole("radio");
    expect(radioButtons).toHaveLength(5);

    const lanternButton = screen.getByRole("radio", {
      name: /select lantern emerald accent color/i,
    });
    expect(lanternButton).toBeInTheDocument();
  });

  it("allows selecting Lantern Emerald and updates UI state and CSS variables", () => {
    render(
      <ThemeProvider initialAccent="blue">
        <AccentPicker />
      </ThemeProvider>,
    );

    const lanternButton = screen.getByRole("radio", {
      name: /select lantern emerald accent color/i,
    });
    expect(lanternButton).toHaveAttribute("aria-checked", "false");

    fireEvent.click(lanternButton);

    expect(lanternButton).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/selected:\s*lantern emerald/i)).toBeInTheDocument();

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--primary-accent")).toBe("#00ff88");
    expect(root.style.getPropertyValue("--accent-lantern")).toBe("#00ff88");
  });

  it("cleans up --accent-lantern property when switching back to another accent", () => {
    render(
      <ThemeProvider initialAccent="lantern-emerald">
        <AccentPicker />
      </ThemeProvider>,
    );

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--accent-lantern")).toBe("#00ff88");

    const blueButton = screen.getByRole("radio", {
      name: /select blue accent color/i,
    });
    fireEvent.click(blueButton);

    expect(blueButton).toHaveAttribute("aria-checked", "true");
    expect(root.style.getPropertyValue("--accent-lantern")).toBe("");
  });

  it("navigates through all 5 options via keyboard arrows", () => {
    render(
      <ThemeProvider initialAccent="blue">
        <AccentPicker />
      </ThemeProvider>,
    );

    const buttons = screen.getAllByRole("radio");
    // Blue is index 0
    expect(buttons[0]).toHaveAttribute("aria-checked", "true");

    // Press ArrowRight to move through the options
    // 0: blue -> 1: purple
    fireEvent.keyDown(buttons[0], { key: "ArrowRight" });
    expect(buttons[1]).toHaveAttribute("aria-checked", "true");

    // 1: purple -> 2: emerald
    fireEvent.keyDown(buttons[1], { key: "ArrowRight" });
    expect(buttons[2]).toHaveAttribute("aria-checked", "true");

    // 2: emerald -> 3: amber
    fireEvent.keyDown(buttons[2], { key: "ArrowRight" });
    expect(buttons[3]).toHaveAttribute("aria-checked", "true");

    // 3: amber -> 4: lantern-emerald
    fireEvent.keyDown(buttons[3], { key: "ArrowRight" });
    expect(buttons[4]).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/selected:\s*lantern emerald/i)).toBeInTheDocument();

    // 4: lantern-emerald -> wraps to 0: blue
    fireEvent.keyDown(buttons[4], { key: "ArrowRight" });
    expect(buttons[0]).toHaveAttribute("aria-checked", "true");
  });

  it("supports Home and End key navigation across all options", () => {
    render(
      <ThemeProvider initialAccent="blue">
        <AccentPicker />
      </ThemeProvider>,
    );

    const buttons = screen.getAllByRole("radio");

    // End should jump to lantern-emerald (last item)
    fireEvent.keyDown(buttons[0], { key: "End" });
    expect(buttons[4]).toHaveAttribute("aria-checked", "true");

    // Home should jump back to blue (first item)
    fireEvent.keyDown(buttons[4], { key: "Home" });
    expect(buttons[0]).toHaveAttribute("aria-checked", "true");
  });
});
