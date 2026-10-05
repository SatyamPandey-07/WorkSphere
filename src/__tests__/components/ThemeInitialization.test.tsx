/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init-script";

function ThemeState() {
  const { theme } = useTheme();
  return <span data-testid="theme-state">{theme}</span>;
}

function runThemeInitScript() {
  new Function(THEME_INIT_SCRIPT)();
}

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "worksphere-theme=; path=/; max-age=0";
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: jest.fn().mockReturnValue({ matches: false }),
  });
});

describe("theme initialization before hydration", () => {
  it("applies a saved dark theme and its colors before rendering the provider", () => {
    window.localStorage.setItem("worksphere-theme", "dark");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: false }),
    });

    runThemeInitScript();

    const root = document.documentElement;
    expect(root).toHaveClass("dark");
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.style.backgroundColor).toBe("rgb(10, 10, 10)");
    expect(document.cookie).toContain("worksphere-theme=dark");
  });

  it("prefers the saved light theme over the dark system preference", () => {
    window.localStorage.setItem("worksphere-theme", "light");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: true }),
    });

    runThemeInitScript();

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.style.backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("uses the system preference when no theme has been saved", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: true }),
    });

    runThemeInitScript();

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("defaults to light when no theme is saved and the system is light", () => {
    runThemeInitScript();

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("preserves the pre-paint theme during provider hydration", () => {
    window.localStorage.setItem("worksphere-theme", "dark");
    runThemeInitScript();

    render(
      <ThemeProvider initialTheme="light">
        <ThemeState />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme-state")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
