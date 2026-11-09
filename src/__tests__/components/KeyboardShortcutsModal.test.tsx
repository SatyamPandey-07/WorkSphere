import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";

const pressKey = (key: string, target: Element = document.body, init = {}) =>
  fireEvent.keyDown(target, { key, ...init });

describe("KeyboardShortcutsModal", () => {
  it("renders nothing until the shortcut is pressed", () => {
    render(<KeyboardShortcutsModal />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on ? and toggles closed on a second ?", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pressKey("?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on Shift + /", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("/", document.body, { shiftKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("?");
    pressKey("Escape");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores ? typed into an input", () => {
    render(
      <>
        <input aria-label="search" />
        <KeyboardShortcutsModal />
      </>,
    );
    pressKey("?", screen.getByLabelText("search"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exposes accessible dialog attributes", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("?");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Keyboard Shortcuts");
  });

  it("closes from the labelled close button", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("?");
    fireEvent.click(
      screen.getByRole("button", { name: /close keyboard shortcuts/i }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the backdrop is clicked, but not the dialog itself", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("?");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus into the dialog when it opens", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("?");
    expect(
      screen.getByRole("button", { name: /close keyboard shortcuts/i }),
    ).toHaveFocus();
  });

  it("keeps Tab focus inside the dialog", () => {
    render(<KeyboardShortcutsModal />);
    pressKey("?");
    const closeButton = screen.getByRole("button", {
      name: /close keyboard shortcuts/i,
    });
    // fireEvent returns false when the event's default was prevented
    expect(pressKey("Tab", closeButton)).toBe(false);
    expect(closeButton).toHaveFocus();
    expect(pressKey("Tab", closeButton, { shiftKey: true })).toBe(false);
    expect(closeButton).toHaveFocus();
  });

  it("returns focus to the previously focused element on close", () => {
    render(
      <>
        <button>trigger</button>
        <KeyboardShortcutsModal />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "trigger" });
    trigger.focus();
    pressKey("?", trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pressKey("Escape");
    expect(trigger).toHaveFocus();
  });
});
