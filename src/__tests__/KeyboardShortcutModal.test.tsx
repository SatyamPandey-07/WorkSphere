/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { KeyboardShortcutModal } from "@/components/whiteboard/KeyboardShortcutModal";

describe("KeyboardShortcutModal search filter", () => {
  it("renders search input with search icon and displays all shortcuts initially", () => {
    render(<KeyboardShortcutModal isOpen={true} onClose={jest.fn()} />);

    expect(
      screen.getByTestId("keyboard-shortcut-search-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("keyboard-shortcut-search-icon"),
    ).toBeInTheDocument();

    const items = screen.getAllByTestId("shortcut-item");
    expect(items).toHaveLength(13);
  });

  it("filters shortcut categories and items case-insensitively and matches expected count", () => {
    render(<KeyboardShortcutModal isOpen={true} onClose={jest.fn()} />);

    const input = screen.getByTestId("keyboard-shortcut-search-input");

    fireEvent.change(input, { target: { value: "AUDIO" } });
    expect(screen.getAllByTestId("shortcut-item")).toHaveLength(2);
    expect(screen.getByText("Toggle audio playback")).toBeInTheDocument();
    expect(screen.getByText("Mute or unmute audio")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "shift" } });
    expect(screen.getAllByTestId("shortcut-item")).toHaveLength(2);
    expect(screen.getByText("Mute or unmute audio")).toBeInTheDocument();
    expect(screen.getByText("Reset active filters")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "map" } });
    expect(screen.getAllByTestId("shortcut-item")).toHaveLength(1);
    expect(screen.getByText("Switch to Map view")).toBeInTheDocument();
  });

  it('displays "No shortcuts found" empty state when query matches nothing', () => {
    render(<KeyboardShortcutModal isOpen={true} onClose={jest.fn()} />);

    const input = screen.getByTestId("keyboard-shortcut-search-input");
    fireEvent.change(input, { target: { value: "nonexistent-shortcut-xyz" } });

    expect(screen.queryAllByTestId("shortcut-item")).toHaveLength(0);
    expect(screen.getByTestId("keyboard-shortcut-empty")).toHaveTextContent(
      "No shortcuts found",
    );
  });
});
