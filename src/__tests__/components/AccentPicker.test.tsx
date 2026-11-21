/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";
import { AccentPicker } from "@/components/AccentPicker";

function ThemeControls() {
  const { accent, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-accent">{accent}</span>
      <button onClick={() => setTheme("light")}>Set Light</button>
      <button onClick={() => setTheme("dark")}>Set Dark</button>
      <button onClick={() => setTheme("cyberpunk")}>Set Cyberpunk</button>
    </div>
  );
}

describe("AccentPicker with Lantern Emerald (#6164)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
  });

  it("renders the requested accents and preserves the existing accent options", () => {
    render(
      <ThemeProvider initialAccent="blue">
        <AccentPicker />
      </ThemeProvider>,
    );

    const radioButtons = screen.getAllByRole("radio");
    expect(radioButtons).toHaveLength(9);

    const lanternButton = screen.getByRole("radio", {
      name: /select lantern emerald accent color/i,
    });
    expect(lanternButton).toBeInTheDocument();

    for (const color of [
      "Indigo",
      "Emerald",
      "Amber",
      "Rose",
      "Cyan",
      "Violet",
    ]) {
      expect(
        screen.getByRole("radio", { name: `Select ${color} accent color` }),
      ).toBeInTheDocument();
    }
  });

  it.each([
    ["Indigo", "indigo", "#4338ca", "#ffffff"],
    ["Emerald", "emerald", "#10b981", "#111827"],
    ["Amber", "amber", "#f59e0b", "#111827"],
    ["Rose", "rose", "#be123c", "#ffffff"],
    ["Cyan", "cyan", "#0e7490", "#ffffff"],
    ["Violet", "violet", "#6d28d9", "#ffffff"],
  ])(
    "selects %s immediately and persists the preference",
    (label, name, hex, foreground) => {
      render(
        <ThemeProvider initialAccent="blue">
          <AccentPicker />
        </ThemeProvider>,
      );

      const swatch = screen.getByRole("radio", {
        name: `Select ${label} accent color`,
      });
      expect(swatch).toHaveAttribute("aria-checked", "false");

      fireEvent.click(swatch);

      expect(swatch).toHaveAttribute("aria-checked", "true");
      expect(swatch.querySelector("svg")).toHaveStyle({ color: foreground });
      expect(screen.getByText(`Selected: ${label}`)).toBeInTheDocument();
      expect(
        document.documentElement.style.getPropertyValue("--primary-accent"),
      ).toBe(hex);
      expect(window.localStorage.getItem("worksphere-accent")).toBe(name);
      expect(document.cookie).toContain(`worksphere-accent=${name}`);
    },
  );

  it("exposes selected state and visible focus treatment on each radio swatch", () => {
    render(
      <ThemeProvider initialAccent="blue">
        <AccentPicker />
      </ThemeProvider>,
    );

    const blueButton = screen.getByRole("radio", {
      name: "Select Blue accent color",
    });
    const indigoButton = screen.getByRole("radio", {
      name: "Select Indigo accent color",
    });

    expect(blueButton).toHaveAttribute("aria-checked", "true");
    expect(blueButton).toHaveAttribute("tabindex", "0");
    expect(indigoButton).toHaveAttribute("aria-checked", "false");
    expect(indigoButton).toHaveAttribute("tabindex", "-1");
    expect(indigoButton).toHaveAttribute("type", "button");
    expect(indigoButton.className).toContain("focus-visible:ring-4");
    expect(indigoButton.className).toContain(
      "dark:focus-visible:ring-zinc-100",
    );
    expect(indigoButton.className).toContain(
      "cyberpunk:focus-visible:ring-fuchsia-200",
    );
  });

  it("restores a persisted accent when the picker initializes", () => {
    window.localStorage.setItem("worksphere-accent", "cyan");

    render(
      <ThemeProvider initialAccent="blue">
        <AccentPicker />
      </ThemeProvider>,
    );

    const cyanButton = screen.getByRole("radio", {
      name: /select cyan accent color/i,
    });
    expect(cyanButton).toHaveAttribute("aria-checked", "true");
    expect(
      document.documentElement.style.getPropertyValue("--primary-accent"),
    ).toBe("#0e7490");
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
    expect(
      screen.getByText(/selected:\s*lantern emerald/i),
    ).toBeInTheDocument();

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

  it("navigates through all options via keyboard arrows and wraps", () => {
    render(
      <ThemeProvider initialAccent="blue">
        <AccentPicker />
      </ThemeProvider>,
    );

    const buttons = screen.getAllByRole("radio");
    expect(buttons[0]).toHaveAttribute("aria-checked", "true");

    for (let index = 0; index < buttons.length; index += 1) {
      const nextIndex = (index + 1) % buttons.length;
      fireEvent.keyDown(buttons[index], { key: "ArrowRight" });
      expect(buttons[nextIndex]).toHaveAttribute("aria-checked", "true");
    }

    expect(buttons[0]).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(buttons[0], { key: "ArrowLeft" });
    expect(buttons[buttons.length - 1]).toHaveAttribute("aria-checked", "true");
  });

  it("supports Home and End key navigation across all options", () => {
    render(
      <ThemeProvider initialAccent="blue">
        <AccentPicker />
      </ThemeProvider>,
    );

    const buttons = screen.getAllByRole("radio");

    // End should jump to the last option.
    fireEvent.keyDown(buttons[0], { key: "End" });
    expect(buttons[8]).toHaveAttribute("aria-checked", "true");

    // Home should jump back to blue (first item).
    fireEvent.keyDown(buttons[8], { key: "Home" });
    expect(buttons[0]).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the active accent applied when switching theme modes", () => {
    render(
      <ThemeProvider initialTheme="light" initialAccent="blue">
        <AccentPicker />
        <ThemeControls />
      </ThemeProvider>,
    );

    fireEvent.click(
      screen.getByRole("radio", { name: /select rose accent color/i }),
    );
    expect(screen.getByTestId("current-accent")).toHaveTextContent("rose");

    fireEvent.click(screen.getByRole("button", { name: "Set Dark" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(
      document.documentElement.style.getPropertyValue("--primary-accent"),
    ).toBe("#be123c");

    fireEvent.click(screen.getByRole("button", { name: "Set Cyberpunk" }));
    expect(document.documentElement).toHaveClass("cyberpunk");
    expect(
      document.documentElement.style.getPropertyValue("--primary-accent"),
    ).toBe("#be123c");

    fireEvent.click(screen.getByRole("button", { name: "Set Light" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("cyberpunk");
    expect(
      document.documentElement.style.getPropertyValue("--primary-accent"),
    ).toBe("#be123c");
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
      const pulseRing = emeraldButton.querySelector(
        '[data-testid="emerald-pulse-ring"]',
      );
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

  describe("Copy HEX Color Code Swatch Tooltip (#5965)", () => {
    const originalClipboard = navigator.clipboard;

    beforeEach(() => {
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
      });
    });

    afterEach(() => {
      Object.assign(navigator, { clipboard: originalClipboard });
    });

    it("displays swatch tooltip with hex code on mouse enter", () => {
      render(
        <ThemeProvider initialAccent="blue">
          <AccentPicker />
        </ThemeProvider>,
      );

      const blueButton = screen.getByRole("radio", {
        name: /select blue accent color/i,
      });

      // Hover over the swatch wrapper
      fireEvent.mouseEnter(blueButton.parentElement!);

      expect(screen.getByTestId("swatch-tooltip-blue")).toBeInTheDocument();
      expect(screen.getByText("#3B82F6")).toBeInTheDocument();
      expect(screen.getByTestId("copy-hex-blue")).toBeInTheDocument();
    });

    it("displays swatch tooltip on focus and hides on blur", () => {
      render(
        <ThemeProvider initialAccent="blue">
          <AccentPicker />
        </ThemeProvider>,
      );

      const purpleButton = screen.getByRole("radio", {
        name: /select purple accent color/i,
      });

      // Focus swatch
      fireEvent.focus(purpleButton.parentElement!);

      expect(screen.getByTestId("swatch-tooltip-purple")).toBeInTheDocument();
      expect(screen.getByText("#A855F7")).toBeInTheDocument();

      // Blur swatch
      fireEvent.blur(purpleButton.parentElement!, {
        relatedTarget: document.body,
      });
      expect(
        screen.queryByTestId("swatch-tooltip-purple"),
      ).not.toBeInTheDocument();
    });

    it("copies exact HEX code to clipboard and displays Copied! badge", async () => {
      render(
        <ThemeProvider initialAccent="blue">
          <AccentPicker />
        </ThemeProvider>,
      );

      const blueButton = screen.getByRole("radio", {
        name: /select blue accent color/i,
      });

      fireEvent.mouseEnter(blueButton.parentElement!);

      const copyButton = screen.getByTestId("copy-hex-blue");
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(screen.getByTestId("copied-badge")).toBeInTheDocument();
      });
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("#3b82f6");
      expect(screen.getByText(/copied!/i)).toBeInTheDocument();
    });

    it("supports keyboard navigation with aria-describedby pointing to tooltip", () => {
      render(
        <ThemeProvider initialAccent="blue">
          <AccentPicker />
        </ThemeProvider>,
      );

      const blueButton = screen.getByRole("radio", {
        name: /select blue accent color/i,
      });

      fireEvent.focus(blueButton.parentElement!);

      expect(blueButton).toHaveAttribute(
        "aria-describedby",
        "swatch-tooltip-blue",
      );
    });
  });
});
