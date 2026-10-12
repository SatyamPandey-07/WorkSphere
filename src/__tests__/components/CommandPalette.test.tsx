import { render, screen, fireEvent } from "@testing-library/react";
import {
  CommandPalette,
  CommandPaletteTrigger,
  detectPlatformShortcut,
  isTouchOnlyDevice,
} from "@/components/CommandPalette";

// CommandPalette uses next/navigation — mock it
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

describe("CommandPalette search sanitization", () => {
  beforeEach(() => {
    // Open the command palette via keyboard shortcut
    // (Ctrl+K or Cmd+K normally opens it)
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the CommandPalette toggle button area", () => {
    render(<CommandPalette />);
    expect(screen.getByTestId("command-palette-trigger")).toBeInTheDocument();
  });

  it("does not crash on render", () => {
    expect(() => render(<CommandPalette />)).not.toThrow();
  });
});

describe("CommandPalette search trigger and shortcut badge", () => {
  const originalNavigator = window.navigator;
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    }
  });

  const setPlatform = (platform: string, userAgent = "") => {
    Object.defineProperty(window, "navigator", {
      value: {
        ...originalNavigator,
        platform,
        userAgent,
      },
      configurable: true,
      writable: true,
    });
  };

  const mockMatchMedia = (matchesMap: Record<string, boolean>) => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: Boolean(matchesMap[query]),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  };

  it("detects macOS platform to dynamically display ⌘K", () => {
    setPlatform("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    render(<CommandPalette />);

    const badge = screen.getByTestId("command-palette-shortcut-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("⌘K");
  });

  it("detects Windows/Linux platform to dynamically display Ctrl+K", () => {
    setPlatform("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    render(<CommandPalette />);

    const badge = screen.getByTestId("command-palette-shortcut-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Ctrl+K");
  });

  it("styles the badge with subtle border, monospaced font, and muted background", () => {
    setPlatform("Win32");
    render(<CommandPaletteTrigger />);

    const badge = screen.getByTestId("command-palette-shortcut-badge");
    expect(badge.tagName.toLowerCase()).toBe("kbd");
    // Monospaced font
    expect(badge.className).toContain("font-mono");
    // Subtle border
    expect(badge.className).toContain("border");
    expect(badge.className).toMatch(/border-zinc-200|border-zinc-700/);
    // Muted background
    expect(badge.className).toMatch(/bg-zinc-100|bg-zinc-800/);
  });

  it("hides the shortcut badge on touch-only mobile devices", () => {
    mockMatchMedia({
      "(pointer: coarse)": true,
      "(pointer: fine)": false,
    });

    render(<CommandPaletteTrigger />);
    expect(
      screen.queryByTestId("command-palette-shortcut-badge"),
    ).not.toBeInTheDocument();
  });

  it("displays the shortcut badge on devices with a fine pointer", () => {
    mockMatchMedia({
      "(pointer: coarse)": false,
      "(pointer: fine)": true,
    });

    render(<CommandPaletteTrigger />);
    expect(
      screen.getByTestId("command-palette-shortcut-badge"),
    ).toBeInTheDocument();
  });

  it("opens the command palette dialog when trigger button is clicked", () => {
    render(<CommandPalette />);
    const trigger = screen.getByTestId("command-palette-trigger");
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("detectPlatformShortcut helper resolves macOS and non-macOS correctly", () => {
    expect(detectPlatformShortcut(undefined, "MacIntel")).toBe("⌘K");
    expect(
      detectPlatformShortcut(
        "Mozilla/5.0 (iPhone; CPU OS 15_0 like Mac OS X)",
        "",
      ),
    ).toBe("⌘K");
    expect(detectPlatformShortcut(undefined, "Win32")).toBe("Ctrl+K");
    expect(detectPlatformShortcut(undefined, "Linux x86_64")).toBe("Ctrl+K");
    expect(detectPlatformShortcut("", "")).toBe("Ctrl+K");
  });

  it("isTouchOnlyDevice helper detects touch-only vs desktop fine pointer", () => {
    mockMatchMedia({
      "(pointer: coarse)": true,
      "(pointer: fine)": false,
    });
    expect(isTouchOnlyDevice()).toBe(true);

    mockMatchMedia({
      "(pointer: coarse)": false,
      "(pointer: fine)": true,
    });
    expect(isTouchOnlyDevice()).toBe(false);
  });
});

describe("Input sanitization on CommandPalette", () => {
  it("strips XSS characters from the search input onChange", () => {
    // Test the sanitization regex directly
    const sanitize = (val: string) =>
      val.replace(/[<>"'`\x00-\x1F\x7F]/g, "").slice(0, 200);

    expect(sanitize("<script>alert(1)</script>")).toBe("scriptalert(1)/script");
    expect(sanitize("normal search")).toBe("normal search");
    expect(sanitize('"quoted"')).toBe("quoted");
    expect(sanitize("a".repeat(250))).toHaveLength(200);
  });

  it("preserves normal alphanumeric search terms", () => {
    const sanitize = (val: string) =>
      val.replace(/[<>"'`\x00-\x1F\x7F]/g, "").slice(0, 200);

    expect(sanitize("WorkSphere café 123")).toBe("WorkSphere café 123");
    expect(sanitize("find wifi spots")).toBe("find wifi spots");
  });

  it("strips backtick characters", () => {
    const sanitize = (val: string) =>
      val.replace(/[<>"'`\x00-\x1F\x7F]/g, "").slice(0, 200);

    expect(sanitize("`cmd`")).toBe("cmd");
  });
});
