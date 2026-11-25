import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  HighContrastToggle,
  HighContrastSwitch,
  HighContrastStatusBadge,
  HIGH_CONTRAST_STORAGE_KEY,
} from "@/components/HighContrastToggle";

describe("HighContrastToggle Component", () => {
  let matchMediaListeners: ((e: MediaQueryListEvent) => void)[] = [];
  let forcedColorsMatches = false;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-high-contrast");
    matchMediaListeners = [];
    forcedColorsMatches = false;

    window.matchMedia = jest.fn().mockImplementation((query: string) => {
      const isForcedColors = query.includes("forced-colors: active");
      return {
        matches: isForcedColors ? forcedColorsMatches : false,
        media: query,
        onchange: null,
        addListener: jest.fn((listener) => {
          if (isForcedColors) matchMediaListeners.push(listener);
        }),
        removeListener: jest.fn((listener) => {
          matchMediaListeners = matchMediaListeners.filter(
            (l) => l !== listener,
          );
        }),
        addEventListener: jest.fn((event, listener) => {
          if (event === "change" && isForcedColors) {
            matchMediaListeners.push(listener);
          }
        }),
        removeEventListener: jest.fn((event, listener) => {
          if (event === "change") {
            matchMediaListeners = matchMediaListeners.filter(
              (l) => l !== listener,
            );
          }
        }),
        dispatchEvent: jest.fn(),
      };
    });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-high-contrast");
  });

  it("reads stored true preference from localStorage on component mount", () => {
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, "true");

    render(<HighContrastToggle />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      true,
    );
    expect(document.documentElement.getAttribute("data-high-contrast")).toBe(
      "true",
    );
  });

  it("reads stored false preference from localStorage on component mount", () => {
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, "false");

    render(<HighContrastToggle />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      false,
    );
  });

  it("persists changes to localStorage and updates DOM class on <html> on toggle", () => {
    render(<HighContrastToggle />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      false,
    );

    // Toggle ON
    fireEvent.click(toggle);

    expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBe("true");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      true,
    );
    expect(document.documentElement.getAttribute("data-high-contrast")).toBe(
      "true",
    );

    // Toggle OFF
    fireEvent.click(toggle);

    expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBe("false");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      false,
    );
    expect(
      document.documentElement.getAttribute("data-high-contrast"),
    ).toBeNull();
  });

  it("syncs with system forced-colors: active media query as a default fallback when unset", () => {
    forcedColorsMatches = true;

    render(<HighContrastToggle />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      true,
    );
  });

  it("preserves explicit localStorage override even if forced-colors is active", () => {
    forcedColorsMatches = true;
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, "false");

    render(<HighContrastToggle />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      false,
    );
  });

  it("dynamically updates when forced-colors changes and no localStorage preference is set", () => {
    render(<HighContrastToggle />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    // Simulate system forced-colors toggling on
    forcedColorsMatches = true;
    act(() => {
      for (const listener of matchMediaListeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      true,
    );
  });

  it("renders switch variant with visible label and toggles properly", () => {
    render(<HighContrastToggle variant="switch" id="custom-switch" />);

    const label = screen.getByText("High Contrast");
    expect(label).toBeInTheDocument();

    const switchBtn = screen.getByRole("switch", { name: /high contrast/i });
    expect(switchBtn).toBeInTheDocument();
    expect(switchBtn).toHaveAttribute("id", "custom-switch");
    expect(switchBtn).toHaveAttribute("aria-checked", "false");

    fireEvent.click(switchBtn);

    expect(switchBtn).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute("data-high-contrast")).toBe(
      "true",
    );
    expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBe("true");
  });

  it("renders HighContrastSwitch component helper correctly", () => {
    render(<HighContrastSwitch id="helper-switch" />);

    const switchBtn = screen.getByRole("switch", { name: /high contrast/i });
    expect(switchBtn).toBeInTheDocument();
    expect(switchBtn).toHaveAttribute("id", "helper-switch");
  });

  it("applies high-contrast visible focus ring classes for WCAG 2.4.7 keyboard navigation compliance", () => {
    render(<HighContrastToggle id="focus-test-toggle" />);

    const switchBtn = screen.getByRole("switch");
    expect(switchBtn.className).toContain("focus-visible:ring-2");
    expect(switchBtn.className).toContain("focus-visible:ring-offset-2");
    expect(switchBtn.className).toContain("focus-visible:ring-amber-400");
    expect(switchBtn.className).toContain("dark:focus-visible:ring-cyan-400");
  });

  describe("HighContrastStatusBadge and integrated status in settings", () => {
    it("displays 'Standard Contrast' by default when disabled", () => {
      render(<HighContrastStatusBadge />);

      const badge = screen.getByTestId("high-contrast-status-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("Standard Contrast");
      expect(badge).toHaveAttribute("aria-live", "polite");
      expect(badge).toHaveAttribute("aria-atomic", "true");
    });

    it("displays 'High Contrast: Active (WCAG AAA)' when high contrast is enabled in localStorage", () => {
      localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, "true");
      render(<HighContrastStatusBadge />);

      const badge = screen.getByTestId("high-contrast-status-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("High Contrast: Active (WCAG AAA)");
      expect(badge).toHaveAttribute("aria-live", "polite");
      expect(badge).toHaveAttribute("aria-atomic", "true");
    });

    it("updates immediately when custom event worksphere_high_contrast_change is fired", () => {
      render(<HighContrastStatusBadge />);

      const badge = screen.getByTestId("high-contrast-status-badge");
      expect(badge).toHaveTextContent("Standard Contrast");

      act(() => {
        window.dispatchEvent(
          new CustomEvent("worksphere_high_contrast_change", { detail: true }),
        );
      });

      expect(badge).toHaveTextContent("High Contrast: Active (WCAG AAA)");

      act(() => {
        window.dispatchEvent(
          new CustomEvent("worksphere_high_contrast_change", { detail: false }),
        );
      });

      expect(badge).toHaveTextContent("Standard Contrast");
    });

    it("updates immediately without page reload when HighContrastToggle is toggled", () => {
      render(
        <div>
          <HighContrastStatusBadge />
          <HighContrastToggle />
        </div>,
      );

      const badge = screen.getByTestId("high-contrast-status-badge");
      const toggle = screen.getByRole("switch");

      expect(badge).toHaveTextContent("Standard Contrast");
      expect(toggle).toHaveAttribute("aria-checked", "false");

      // Click toggle
      fireEvent.click(toggle);

      expect(badge).toHaveTextContent("High Contrast: Active (WCAG AAA)");
      expect(toggle).toHaveAttribute("aria-checked", "true");

      // Click toggle again
      fireEvent.click(toggle);

      expect(badge).toHaveTextContent("Standard Contrast");
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });

    it("renders badge within HighContrastToggle when showStatusBadge=true", () => {
      render(<HighContrastToggle showStatusBadge />);

      const badge = screen.getByTestId("high-contrast-status-badge");
      const toggle = screen.getByRole("switch");

      expect(badge).toHaveTextContent("Standard Contrast");

      fireEvent.click(toggle);

      expect(badge).toHaveTextContent("High Contrast: Active (WCAG AAA)");
    });

    it("syncs badge with system forced-colors media query when unset", () => {
      forcedColorsMatches = true;
      render(<HighContrastStatusBadge />);

      const badge = screen.getByTestId("high-contrast-status-badge");
      expect(badge).toHaveTextContent("High Contrast: Active (WCAG AAA)");
    });

    it("updates badge when forced-colors changes dynamically", () => {
      render(<HighContrastStatusBadge />);

      const badge = screen.getByTestId("high-contrast-status-badge");
      expect(badge).toHaveTextContent("Standard Contrast");

      forcedColorsMatches = true;
      act(() => {
        for (const listener of matchMediaListeners) {
          listener({ matches: true } as MediaQueryListEvent);
        }
      });

      expect(badge).toHaveTextContent("High Contrast: Active (WCAG AAA)");
    });
  });
});
