import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { KeyboardShortcutModal } from "@/components/ui/KeyboardShortcutModal";

describe("KeyboardShortcutModal", () => {
  it("opens when pressing ? outside input fields and displays grouped shortcuts", () => {
    render(
      <div>
        <button type="button">Outside Button</button>
        <KeyboardShortcutModal />
      </div>
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "?", shiftKey: true });

    const dialog = screen.getByRole("dialog", { name: /keyboard shortcuts/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");

    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Venue Actions")).toBeInTheDocument();
    expect(screen.getByText("Audio Controls")).toBeInTheDocument();
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("Switch to Grid view")).toBeInTheDocument();
    expect(screen.getByText("Switch to Compact view")).toBeInTheDocument();
    expect(screen.getByText("Switch to Map view")).toBeInTheDocument();
  });

  it("does not open when pressing ? inside an input or textarea", () => {
    render(
      <div>
        <input aria-label="Search venues" />
        <textarea aria-label="Notes" />
        <KeyboardShortcutModal />
      </div>
    );

    const input = screen.getByLabelText("Search venues");
    input.focus();
    fireEvent.keyDown(input, { key: "?", shiftKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const textarea = screen.getByLabelText("Notes");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "?", shiftKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("filters shortcuts by description name and keybinding", () => {
    render(<KeyboardShortcutModal isOpen={true} onClose={jest.fn()} />);

    const searchInput = screen.getByLabelText(/search keyboard shortcuts/i);

    fireEvent.change(searchInput, { target: { value: "Grid" } });
    expect(screen.getByText("Switch to Grid view")).toBeInTheDocument();
    expect(screen.queryByText("Toggle audio playback")).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "Esc" } });
    expect(screen.getByText("Dismiss drawers or modal")).toBeInTheDocument();
    expect(screen.queryByText("Switch to Grid view")).not.toBeInTheDocument();
  });

  it("closes via Escape key and backdrop click", () => {
    const onClose = jest.fn();
    render(<KeyboardShortcutModal isOpen={true} onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: /keyboard shortcuts/i });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("keyboard-shortcut-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
