/** @jest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";

type MediaChangeListener = (event: MediaQueryListEvent) => void;

function createMockMatchMedia(initialMatches = false) {
  let matches = initialMatches;
  const listeners = new Set<MediaChangeListener>();

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: jest.fn((event: string, listener: MediaChangeListener) => {
      if (event === "change") {
        listeners.add(listener);
      }
    }),
    removeEventListener: jest.fn(
      (event: string, listener: MediaChangeListener) => {
        if (event === "change") {
          listeners.delete(listener);
        }
      },
    ),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  };

  const matchMedia = jest.fn().mockReturnValue(mediaQueryList);

  const setSystemDark = (isDark: boolean) => {
    matches = isDark;
    const event = {
      matches: isDark,
      media: "(prefers-color-scheme: dark)",
    } as MediaQueryListEvent;
    listeners.forEach((listener) => listener(event));
  };

  return { matchMedia, mediaQueryList, listeners, setSystemDark };
}

function ThemeConsumer() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <button onClick={() => setTheme("system")}>Set System</button>
      <button onClick={() => setTheme("light")}>Set Light</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "worksphere-theme=; path=/; max-age=0";
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});

describe("system preference theme listener", () => {
  it("syncs data-theme and Tailwind dark class immediately when OS theme changes in system mode", () => {
    const { matchMedia, setSystemDark } = createMockMatchMedia(false);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    render(
      <ThemeProvider initialTheme="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("system");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement).not.toHaveClass("dark");

    act(() => {
      setSystemDark(true);
    });

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveClass("dark");

    act(() => {
      setSystemDark(false);
    });

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("ignores OS preference changes when theme is explicitly set to light", () => {
    const { matchMedia, setSystemDark } = createMockMatchMedia(false);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    render(
      <ThemeProvider initialTheme="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    act(() => {
      setSystemDark(true);
    });

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("cleans up the matchMedia change listener on unmount without memory leaks", () => {
    const { matchMedia, mediaQueryList, listeners } =
      createMockMatchMedia(false);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    const { unmount } = render(
      <ThemeProvider initialTheme="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(mediaQueryList.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(listeners.size).toBe(1);

    unmount();

    expect(mediaQueryList.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(listeners.size).toBe(0);
  });
});
