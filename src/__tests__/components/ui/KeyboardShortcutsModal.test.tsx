import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  KeyboardShortcutsModal,
  DEFAULT_SHORTCUTS,
} from "@/components/ui/KeyboardShortcutsModal";

const pressKey = (key: string, target: Element | Window = window, init = {}) =>
  fireEvent.keyDown(target, { key, ...init });

describe("KeyboardShortcutsModal (Issue #8626)", () => {
  // Test 1 — Component rendering
  it("renders closed initially and does not display modal content until activated", () => {
    render(<KeyboardShortcutsModal />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders with expected heading, subtitle, and accessible attributes when open", () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={jest.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Keyboard Shortcuts");
    expect(
      screen.getByText("Hotkeys to navigate and perform actions across WorkSphere"),
    ).toBeInTheDocument();
  });

  // Test 2 — Question mark trigger
  it("opens modal on '?' keypress and toggles closed on second '?' keypress", () => {
    render(<KeyboardShortcutsModal />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    pressKey("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    pressKey("?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens modal on Shift + /", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("/", window, { shiftKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ignores '?' when Ctrl, Alt, or Meta modifier is held", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("?", window, { ctrlKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    pressKey("?", window, { altKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    pressKey("?", window, { metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Test 3 — Input protection
  it("does not open when pressing '?' inside input, textarea, select, or contenteditable", () => {
    render(
      <div>
        <input data-testid="test-input" />
        <textarea data-testid="test-textarea" />
        <select data-testid="test-select">
          <option value="1">1</option>
        </select>
        <div data-testid="test-editable" contentEditable="true" />
        <KeyboardShortcutsModal />
      </div>,
    );

    const input = screen.getByTestId("test-input");
    input.focus();
    fireEvent.keyDown(input, { key: "?" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const textarea = screen.getByTestId("test-textarea");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "?" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const select = screen.getByTestId("test-select");
    select.focus();
    fireEvent.keyDown(select, { key: "?" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const editable = screen.getByTestId("test-editable");
    editable.focus();
    fireEvent.keyDown(editable, { key: "?" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Test 4 — Escape behavior
  it("closes modal on Escape key press", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    pressKey("Escape");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes modal on close button click and backdrop click", () => {
    const onClose = jest.fn();
    render(<KeyboardShortcutsModal isOpen={true} onClose={onClose} />);

    fireEvent.click(
      screen.getByRole("button", { name: /close keyboard shortcuts/i }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("keyboard-shortcuts-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // Test 5 — Focus management and Focus trap
  it("moves initial focus into the modal and restores focus on close", () => {
    render(
      <div>
        <button data-testid="trigger-btn">Trigger</button>
        <KeyboardShortcutsModal />
      </div>,
    );

    const triggerBtn = screen.getByTestId("trigger-btn");
    triggerBtn.focus();
    expect(triggerBtn).toHaveFocus();

    pressKey("?");
    const closeBtn = screen.getByRole("button", {
      name: /close keyboard shortcuts/i,
    });
    expect(closeBtn).toHaveFocus();

    pressKey("Escape");
    expect(triggerBtn).toHaveFocus();
  });

  // Test 6 — Listener cleanup on unmount
  it("removes keydown listener on unmount without throwing errors or leaking", () => {
    const { unmount } = render(<KeyboardShortcutsModal />);
    unmount();

    expect(() => pressKey("?")).not.toThrow();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Test 7 — Listener duplication & rerenders
  it("does not duplicate listeners across multiple rerenders", () => {
    const { rerender } = render(<KeyboardShortcutsModal />);
    rerender(<KeyboardShortcutsModal />);
    rerender(<KeyboardShortcutsModal />);

    pressKey("?");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  // Test 8 — Required shortcut cheat sheet content
  it("displays all required application shortcuts", () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={jest.fn()} />);

    expect(screen.getByText("Book seat")).toBeInTheDocument();
    expect(screen.getByText("Favorite")).toBeInTheDocument();
    expect(screen.getByText("Share")).toBeInTheDocument();
    expect(screen.getByText("Focus search")).toBeInTheDocument();
    expect(screen.getByText("Close modals")).toBeInTheDocument();
    expect(screen.getByText("Show keyboard shortcuts")).toBeInTheDocument();

    const kbdElements = screen.getAllByText(/^(B|F|S|\/|Esc|\?)$/);
    expect(kbdElements.length).toBeGreaterThanOrEqual(6);
  });

  // Test 9 — Custom shortcuts prop support
  it("supports passing custom shortcuts list", () => {
    const custom = [
      { key: "Ctrl+P", action: "Quick Print" },
      { key: "G", action: "Go to Overview" },
    ];
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        shortcuts={custom}
      />,
    );

    expect(screen.getByText("Quick Print")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+P")).toBeInTheDocument();
    expect(screen.getByText("Go to Overview")).toBeInTheDocument();
    expect(screen.getByText("G")).toBeInTheDocument();
  });
});
