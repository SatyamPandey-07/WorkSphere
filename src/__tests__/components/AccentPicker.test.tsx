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

  describe("Emerald swatch glowing power ring pulse effect (#6170)", () => {
    it("renders dual glowing pulse ring elements on emerald swatches", () => {
      render(
        <ThemeProvider initialAccent="blue">
          <AccentPicker />
        </ThemeProvider>,
      );

      const pulseRings = screen.getAllByTestId("emerald-pulse-ring");
      expect(pulseRings.length).toBeGreaterThanOrEqual(1);

      const emeraldButton = screen.getByRole("radio", {
        name: /select emerald accent color/i,
      });
      expect(emeraldButton).toHaveAttribute("data-emerald-swatch", "true");
      expect(emeraldButton.className).toMatch(/ring-emerald-400\/50/);
    });

    it("displays glowing power ring effect and scale on mouse hover", () => {
      render(
        <ThemeProvider initialAccent="blue">
          <AccentPicker />
        </ThemeProvider>,
      );

      const emeraldButton = screen.getByRole("radio", {
        name: /select emerald accent color/i,
      });

      fireEvent.mouseEnter(emeraldButton);

      expect(emeraldButton.className).toContain("ring-4");
      expect(emeraldButton.className).toContain("ring-emerald-400/50");
      expect(emeraldButton.className).toContain("scale-110");

      fireEvent.mouseLeave(emeraldButton);
      expect(emeraldButton.className).not.toMatch(/(^|\s)ring-4(\s|$)/);
    });

    it("displays glowing power ring effect on focus", () => {
      render(
        <ThemeProvider initialAccent="blue">
          <AccentPicker />
        </ThemeProvider>,
      );

      const emeraldButton = screen.getByRole("radio", {
        name: /select emerald accent color/i,
      });

      fireEvent.focus(emeraldButton);

      expect(emeraldButton.className).toContain("ring-4");
      expect(emeraldButton.className).toContain("ring-emerald-400/50");

      fireEvent.blur(emeraldButton);
      expect(emeraldButton.className).not.toMatch(/(^|\s)ring-4(\s|$)/);
    });

    it("settles cleanly without outer pulse ring opacity when active/selected", () => {
      render(
        <ThemeProvider initialAccent="emerald">
          <AccentPicker />
        </ThemeProvider>,
      );

      const emeraldButton = screen.getByRole("radio", {
        name: /select emerald accent color/i,
      });
      expect(emeraldButton).toHaveAttribute("aria-checked", "true");

      // Finding the pulse ring inside this button
      const pulseRing = emeraldButton.querySelector('[data-testid="emerald-pulse-ring"]');
      expect(pulseRing).toHaveClass("opacity-0");
    });

    it("disables transform motion when prefers-reduced-motion is active", () => {
      // Mock prefers-reduced-motion: reduce
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      render(
        <ThemeProvider initialAccent="blue">
          <AccentPicker />
        </ThemeProvider>,
      );

      const emeraldButton = screen.getByRole("radio", {
        name: /select emerald accent color/i,
      });

      expect(emeraldButton.className).toContain("transform-none");

      fireEvent.mouseEnter(emeraldButton);

      // On hover with reduced motion, scale-110 must NOT be applied
      expect(emeraldButton.className).not.toContain("scale-110");
      expect(emeraldButton.className).toContain("ring-emerald-400/50");

      window.matchMedia = originalMatchMedia;
    });
  });
});
