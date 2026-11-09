import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  HighContrastToggle,
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
});
