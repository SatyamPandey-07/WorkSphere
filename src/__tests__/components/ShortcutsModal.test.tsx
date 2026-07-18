import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShortcutsModal } from "@/components/ui/ShortcutsModal";

describe("ShortcutsModal", () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ShortcutsModal isOpen={false} onClose={mockOnClose} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders keyboard shortcuts guide when open", () => {
    render(<ShortcutsModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(
      screen.getByText("Show or hide this shortcuts guide"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Close any active modal or panel"),
    ).toBeInTheDocument();
    expect(screen.getByText("Focus the search input")).toBeInTheDocument();
    expect(
      screen.getByText("Select next venue card in the list"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Select previous venue card in the list"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Open details dialog for selected venue"),
    ).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    render(<ShortcutsModal isOpen={true} onClose={mockOnClose} />);

    const closeButton = screen.getByRole("button", {
      name: /close keyboard shortcuts/i,
    });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
