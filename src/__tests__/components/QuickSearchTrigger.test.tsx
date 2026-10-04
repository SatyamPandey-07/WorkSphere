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
    expect(screen.getByTestId("keyboard-shortcut-badge")).toBeInTheDocument();
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
});
