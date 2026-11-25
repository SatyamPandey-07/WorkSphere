import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickSearchTrigger } from "@/components/ui/QuickSearchTrigger";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/hooks/usePlatformModifier";

describe("QuickSearchTrigger", () => {
  it("renders navbar variant with search label and shortcut badge", () => {
    render(<QuickSearchTrigger variant="navbar" />);

    const button = screen.getByTestId("quick-search-trigger");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
    const shortcutBadge = screen.getByTestId("keyboard-shortcut-badge");
    expect(shortcutBadge).toBeInTheDocument();
    expect(shortcutBadge).toHaveClass("hidden", "md:inline-flex");
  });

  it("renders icon-only variant with aria-label", () => {
    render(<QuickSearchTrigger variant="icon-only" />);

    const button = screen.getByTestId("quick-search-trigger-icon");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
  });

  it("dispatches OPEN_COMMAND_PALETTE_EVENT on click", () => {
    const listener = jest.fn();
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);

    render(<QuickSearchTrigger />);
    const button = screen.getByTestId("quick-search-trigger");
    fireEvent.click(button);

    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);
  });

  it("renders subtle cockpit corner reticles on trigger variants", () => {
    const { unmount } = render(<QuickSearchTrigger variant="navbar" />);
    expect(screen.getByTestId("quick-search-reticles")).toBeInTheDocument();
    unmount();

    render(<QuickSearchTrigger variant="icon-only" />);
    expect(
      screen.getByTestId("quick-search-reticles-icon"),
    ).toBeInTheDocument();
  });
});

describe("QuickSearchTrigger platform shortcut badge", () => {
  const originalNavigator = window.navigator;

  afterEach(() => {
    Object.defineProperty(window, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it.each([
    ["MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "⌘K"],
    ["Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Ctrl+K"],
    ["Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)", "Ctrl+K"],
  ])("shows %s platform shortcut", (platform, userAgent, expected) => {
    Object.defineProperty(window, "navigator", {
      value: { ...originalNavigator, platform, userAgent },
      configurable: true,
      writable: true,
    });

    render(<QuickSearchTrigger />);

    expect(screen.getByTestId("keyboard-shortcut-badge")).toHaveTextContent(
      expected,
    );
  });
});
