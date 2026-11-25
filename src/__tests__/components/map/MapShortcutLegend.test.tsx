import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MapShortcutLegend, MAP_SHORTCUTS } from "@/components/map/MapShortcutLegend";

describe("MapShortcutLegend", () => {
  it("renders the keyboard shortcuts help button with proper accessibility attributes", () => {
    render(<MapShortcutLegend />);

    const button = screen.getByTestId("map-shortcut-legend-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-label", "Keyboard shortcuts");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the modal legend when the help button is clicked", () => {
    render(<MapShortcutLegend />);

    const button = screen.getByTestId("map-shortcut-legend-button");
    fireEvent.click(button);

    expect(screen.getByTestId("map-shortcut-legend-dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Map Navigation Shortcuts")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");

    // All shortcuts are rendered
    MAP_SHORTCUTS.forEach((item) => {
      expect(screen.getByText(item.action)).toBeInTheDocument();
      expect(screen.getByText(item.description)).toBeInTheDocument();
    });
  });

  it("closes the modal legend when the close button is clicked", () => {
    render(<MapShortcutLegend />);

    fireEvent.click(screen.getByTestId("map-shortcut-legend-button"));
    expect(screen.getByTestId("map-shortcut-legend-dialog")).toBeInTheDocument();

    const closeBtn = screen.getByTestId("map-shortcut-legend-close");
    expect(closeBtn).toHaveAttribute("aria-label", "Close keyboard shortcuts");
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();
  });

  it("closes the modal legend when clicking the backdrop", () => {
    render(<MapShortcutLegend />);

    fireEvent.click(screen.getByTestId("map-shortcut-legend-button"));
    const backdrop = screen.getByTestId("map-shortcut-legend-backdrop");

    fireEvent.click(backdrop);
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();
  });

  it("toggles the modal open and closed via '?' shortcut key", () => {
    render(<MapShortcutLegend />);

    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();

    // Trigger '?' key
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByTestId("map-shortcut-legend-dialog")).toBeInTheDocument();

    // Trigger '?' key again to toggle close
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();
  });

  it("toggles the modal via 'Shift + /'", () => {
    render(<MapShortcutLegend />);

    fireEvent.keyDown(window, { key: "/", shiftKey: true });
    expect(screen.getByTestId("map-shortcut-legend-dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "/", shiftKey: true });
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();
  });

  it("closes the modal when pressing Escape", () => {
    render(<MapShortcutLegend />);

    fireEvent.click(screen.getByTestId("map-shortcut-legend-button"));
    expect(screen.getByTestId("map-shortcut-legend-dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();
  });

  it("does not trigger shortcut when user is typing in form inputs, textareas, or selects", () => {
    render(
      <div>
        <input data-testid="test-input" type="text" />
        <textarea data-testid="test-textarea" />
        <select data-testid="test-select">
          <option>1</option>
        </select>
        <MapShortcutLegend />
      </div>
    );

    const input = screen.getByTestId("test-input");
    input.focus();
    fireEvent.keyDown(input, { key: "?" });
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();

    const textarea = screen.getByTestId("test-textarea");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "?" });
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();

    const select = screen.getByTestId("test-select");
    select.focus();
    fireEvent.keyDown(select, { key: "?" });
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();
  });

  it("ignores modifier keys (Ctrl, Alt, Meta)", () => {
    render(<MapShortcutLegend />);

    fireEvent.keyDown(window, { key: "?", ctrlKey: true });
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "?", altKey: true });
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "?", metaKey: true });
    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();
  });

  it("supports controlled mode via isOpen, onOpen, and onClose", () => {
    const handleOpen = jest.fn();
    const handleClose = jest.fn();

    const { rerender } = render(
      <MapShortcutLegend isOpen={false} onOpen={handleOpen} onClose={handleClose} />
    );

    expect(screen.queryByTestId("map-shortcut-legend-dialog")).not.toBeInTheDocument();

    const button = screen.getByTestId("map-shortcut-legend-button");
    fireEvent.click(button);
    expect(handleOpen).toHaveBeenCalledTimes(1);

    rerender(
      <MapShortcutLegend isOpen={true} onOpen={handleOpen} onClose={handleClose} />
    );
    expect(screen.getByTestId("map-shortcut-legend-dialog")).toBeInTheDocument();

    const closeBtn = screen.getByTestId("map-shortcut-legend-close");
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
