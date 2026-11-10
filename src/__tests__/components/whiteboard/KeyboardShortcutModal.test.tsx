import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import KeyboardShortcutModal, {
  KeyboardShortcutModal as NamedShortcutModal,
  ShortcutItem,
} from "@/components/whiteboard/KeyboardShortcutModal";

describe("KeyboardShortcutModal Component", () => {
  const originalOverflow = document.body.style.overflow;

  afterEach(() => {
    document.body.style.overflow = originalOverflow;
    jest.clearAllMocks();
  });

  it("exports named KeyboardShortcutModal and default KeyboardShortcutModal", () => {
    expect(KeyboardShortcutModal).toBeDefined();
    expect(NamedShortcutModal).toBe(KeyboardShortcutModal);
  });

  it("returns null when isOpen is false", () => {
    const { container } = render(
      <KeyboardShortcutModal isOpen={false} onClose={jest.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders dialog with ARIA attributes and default shortcuts when isOpen is true", () => {
    render(<KeyboardShortcutModal isOpen={true} onClose={jest.fn()} />);

    const modal = screen.getByRole("dialog");
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveAttribute("aria-modal", "true");
    expect(modal).toHaveAttribute("aria-labelledby", "shortcut-modal-title");
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();

    // Default shortcuts
    expect(screen.getByTestId("shortcut-item-pen")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-item-eraser")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-item-sticky-note")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-item-undo")).toBeInTheDocument();
  });

  it("locks body overflow to hidden when open, and restores on unmount", () => {
    const { unmount } = render(
      <KeyboardShortcutModal isOpen={true} onClose={jest.fn()} />
    );
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe(originalOverflow);
  });

  it("focuses close button on mount", () => {
    render(<KeyboardShortcutModal isOpen={true} onClose={jest.fn()} />);
    const closeBtn = screen.getByTestId("shortcut-close-button");
    expect(document.activeElement).toBe(closeBtn);
  });

  it("calls onClose when Escape key is pressed", () => {
    const handleClose = jest.fn();
    render(<KeyboardShortcutModal isOpen={true} onClose={handleClose} />);

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking outside modal on the backdrop", () => {
    const handleClose = jest.fn();
    render(<KeyboardShortcutModal isOpen={true} onClose={handleClose} />);

    const backdrop = screen.getByTestId("keyboard-shortcut-modal");
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when clicking inside the modal content", () => {
    const handleClose = jest.fn();
    render(<KeyboardShortcutModal isOpen={true} onClose={handleClose} />);

    const title = screen.getByText("Keyboard Shortcuts");
    fireEvent.click(title);
    expect(handleClose).not.toHaveBeenCalled();
  });

  it("calls onClose when close button or Got it button is clicked", () => {
    const handleClose = jest.fn();
    render(<KeyboardShortcutModal isOpen={true} onClose={handleClose} />);

    const closeBtn = screen.getByTestId("shortcut-close-button");
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    const gotItBtn = screen.getByTestId("shortcut-got-it-button");
    fireEvent.click(gotItBtn);
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it("traps focus between first and last focusable elements on Tab and Shift+Tab", () => {
    render(<KeyboardShortcutModal isOpen={true} onClose={jest.fn()} />);

    const closeBtn = screen.getByTestId("shortcut-close-button");
    const gotItBtn = screen.getByTestId("shortcut-got-it-button");

    // Start at last element and press Tab -> cycles to first element
    gotItBtn.focus();
    expect(document.activeElement).toBe(gotItBtn);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);

    // Start at first element and press Shift+Tab -> cycles to last element
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(gotItBtn);
  });

  it("renders custom shortcuts when provided via shortcuts prop", () => {
    const customShortcuts: ShortcutItem[] = [
      {
        name: "Laser Pointer",
        keys: ["L"],
        description: "Highlight points dynamically",
      },
      {
        name: "Zoom Extents",
        keys: ["Shift", "+", "1"],
        description: "Fit all canvas items into view",
      },
    ];

    render(
      <KeyboardShortcutModal
        isOpen={true}
        onClose={jest.fn()}
        shortcuts={customShortcuts}
      />
    );

    expect(screen.getByTestId("shortcut-item-laser-pointer")).toBeInTheDocument();
    expect(screen.getByText("Laser Pointer")).toBeInTheDocument();
    expect(screen.getByText("Highlight points dynamically")).toBeInTheDocument();

    expect(screen.getByTestId("shortcut-item-zoom-extents")).toBeInTheDocument();
    expect(screen.getByText("Zoom Extents")).toBeInTheDocument();

    // Default pen should not be present
    expect(screen.queryByTestId("shortcut-item-pen")).toBeNull();
  });

  it("merges custom className onto modal card", () => {
    render(
      <KeyboardShortcutModal
        isOpen={true}
        onClose={jest.fn()}
        className="custom-shortcut-theme"
      />
    );

    const modal = screen.getByRole("dialog");
    const card = modal.querySelector(".custom-shortcut-theme");
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass("w-full", "max-w-md", "custom-shortcut-theme");
  });
});
