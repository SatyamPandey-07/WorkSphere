import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { KeyboardShortcutModal } from "@/components/whiteboard/KeyboardShortcutModal";

describe("KeyboardShortcutModal - Backdrop Scroll Lock (#5595)", () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    document.body.style.overflow = "";
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("locks document.body overflow when modal is opened", () => {
    expect(document.body.style.overflow).toBe("");

    const { rerender } = render(
      <KeyboardShortcutModal isOpen={true} onClose={mockOnClose} />
    );

    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByTestId("keyboard-shortcut-modal")).toBeInTheDocument();

    // Rerender as closed
    rerender(<KeyboardShortcutModal isOpen={false} onClose={mockOnClose} />);

    expect(document.body.style.overflow).toBe("");
  });

  it("restores original document.body overflow on unmount", () => {
    document.body.style.overflow = "auto";

    const { unmount } = render(
      <KeyboardShortcutModal isOpen={true} onClose={mockOnClose} />
    );

    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.body.style.overflow).toBe("auto");
  });

  it("does not lock scroll if modal is initially closed", () => {
    render(<KeyboardShortcutModal isOpen={false} onClose={mockOnClose} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape and tears down scroll lock", () => {
    const { rerender } = render(
      <KeyboardShortcutModal isOpen={true} onClose={mockOnClose} />
    );

    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    rerender(<KeyboardShortcutModal isOpen={false} onClose={mockOnClose} />);
    expect(document.body.style.overflow).toBe("");
  });
});
