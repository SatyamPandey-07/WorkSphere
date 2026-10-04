import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ShortcutTooltip } from "@/components/ui/ShortcutTooltip";

describe("ShortcutTooltip", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders child trigger element without tooltip initially", () => {
    render(
      <ShortcutTooltip content="Quick search" shortcut="K">
        <button>Search</button>
      </ShortcutTooltip>
    );

    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.queryByTestId("shortcut-tooltip")).not.toBeInTheDocument();
  });

  it("adds aria-keyshortcuts and title to trigger child", () => {
    render(
      <ShortcutTooltip content="Quick search" shortcut="K">
        <button>Search</button>
      </ShortcutTooltip>
    );

    const button = screen.getByRole("button", { name: /search/i });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
    expect(button).toHaveAttribute("title");
  });

  it("shows tooltip on mouseEnter and hides on mouseLeave", () => {
    render(
      <ShortcutTooltip content="Quick search" shortcut="K" delayMs={50}>
        <button>Search</button>
      </ShortcutTooltip>
    );

    const wrapper = screen.getByText("Search").parentElement!;

    // Hover
    fireEvent.mouseEnter(wrapper);
    act(() => {
      jest.advanceTimersByTime(50);
    });

    const tooltip = screen.getByTestId("shortcut-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveAttribute("role", "tooltip");
    expect(tooltip).toHaveTextContent("Quick search");

    // Leave
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByTestId("shortcut-tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip on keyboard focus and hides on blur", () => {
    render(
      <ShortcutTooltip content="Open AI Chat" shortcut="/" delayMs={50}>
        <button>Open</button>
      </ShortcutTooltip>
    );

    const wrapper = screen.getByText("Open").parentElement!;

    // Focus
    fireEvent.focus(wrapper);
    act(() => {
      jest.advanceTimersByTime(50);
    });

    expect(screen.getByTestId("shortcut-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-tooltip")).toHaveTextContent("Open AI Chat");

    // Blur
    fireEvent.blur(wrapper);
    expect(screen.queryByTestId("shortcut-tooltip")).not.toBeInTheDocument();
  });
});
