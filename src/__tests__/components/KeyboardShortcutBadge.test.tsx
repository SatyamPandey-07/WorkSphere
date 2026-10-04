import React from "react";
import { render, screen } from "@testing-library/react";
import { KeyboardShortcutBadge } from "@/components/ui/KeyboardShortcutBadge";

describe("KeyboardShortcutBadge", () => {
  it("renders a semantic <kbd> element with shortcut text", () => {
    render(<KeyboardShortcutBadge shortcut="K" />);
    const badge = screen.getByTestId("keyboard-shortcut-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.tagName.toLowerCase()).toBe("kbd");
    expect(badge).toHaveTextContent("K");
  });

  it("includes accessible aria-label", () => {
    render(<KeyboardShortcutBadge shortcut="K" />);
    const badge = screen.getByTestId("keyboard-shortcut-badge");
    expect(badge).toHaveAttribute("aria-label");
    expect(badge.getAttribute("aria-label")).toMatch(/plus K/i);
  });

  it("applies size classes appropriately", () => {
    const { rerender } = render(<KeyboardShortcutBadge shortcut="/" size="xs" />);
    expect(screen.getByTestId("keyboard-shortcut-badge")).toHaveClass("text-[10px]");

    rerender(<KeyboardShortcutBadge shortcut="/" size="sm" />);
    expect(screen.getByTestId("keyboard-shortcut-badge")).toHaveClass("text-xs");

    rerender(<KeyboardShortcutBadge shortcut="/" size="md" />);
    expect(screen.getByTestId("keyboard-shortcut-badge")).toHaveClass("text-xs");
  });

  it("applies custom className", () => {
    render(<KeyboardShortcutBadge shortcut="K" className="custom-class" />);
    expect(screen.getByTestId("keyboard-shortcut-badge")).toHaveClass("custom-class");
  });
});
