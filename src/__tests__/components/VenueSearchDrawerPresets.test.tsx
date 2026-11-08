import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { VenueSearchDrawer } from "@/components/venues/VenueSearchDrawer";

jest.mock("@/hooks/usePlatformModifier", () => ({
  usePlatformModifier: () => ({
    formatShortcut: (s: string) => `Ctrl+${s}`,
    getAriaKeyshortcuts: () => "Control+K",
  }),
}));

describe("VenueSearchDrawer duplicate preset prevention", () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("prevents saving duplicate filter preset names", () => {
    window.alert = jest.fn();

    render(
      <VenueSearchDrawer
        isOpen={true}
        onClose={mockOnClose}
      />,
    );

    // Open save preset form
    const openSaveBtn = screen.getByTestId("open-save-preset-btn");
    fireEvent.click(openSaveBtn);

    const presetInput = screen.getByTestId("preset-name-input");
    fireEvent.change(presetInput, { target: { value: "Quiet Morning" } });

    const confirmSaveBtn = screen.getByTestId("confirm-save-preset-btn");
    fireEvent.click(confirmSaveBtn);

    // Try saving duplicate preset with same name
    const openSaveBtn2 = screen.getByTestId("open-save-preset-btn");
    fireEvent.click(openSaveBtn2);

    const presetInput2 = screen.getByTestId("preset-name-input");
    fireEvent.change(presetInput2, { target: { value: "quiet morning" } });

    const confirmSaveBtn2 = screen.getByTestId("confirm-save-preset-btn");
    fireEvent.click(confirmSaveBtn2);

    expect(window.alert).toHaveBeenCalledWith("A preset with this name already exists.");
  });
});
