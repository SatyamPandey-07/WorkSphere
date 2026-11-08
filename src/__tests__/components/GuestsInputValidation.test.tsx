import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import GuestsInput, { GuestEntry } from "@/components/GuestsInput";

describe("GuestsInput email validation and space-key behavior", () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not trigger premature guest addition on space key press while typing email", () => {
    const guests: GuestEntry[] = [];

    render(
      <GuestsInput
        guests={guests}
        onChange={mockOnChange}
        maxGuests={5}
      />,
    );

    const input = screen.getByPlaceholderText("Add guest email...");
    fireEvent.change(input, { target: { value: "user" } });
    fireEvent.keyDown(input, { key: " ", code: "Space" });

    // Space key should not trigger addGuest or validation error
    expect(mockOnChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Please enter a valid email address")).not.toBeInTheDocument();
  });

  it("adds guest on Enter key when email is valid", () => {
    const guests: GuestEntry[] = [];

    render(
      <GuestsInput
        guests={guests}
        onChange={mockOnChange}
        maxGuests={5}
      />,
    );

    const input = screen.getByPlaceholderText("Add guest email...");
    fireEvent.change(input, { target: { value: "alex@example.com" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const addedGuests = mockOnChange.mock.calls[0][0];
    expect(addedGuests).toHaveLength(1);
    expect(addedGuests[0].email).toBe("alex@example.com");
  });

  it("prevents adding duplicate guest email addresses", () => {
    const existingGuests: GuestEntry[] = [
      { id: "g1", email: "existing@example.com", name: "Existing Guest" },
    ];

    render(
      <GuestsInput
        guests={existingGuests}
        onChange={mockOnChange}
        maxGuests={5}
      />,
    );

    const input = screen.getByPlaceholderText("Add another guest...");
    fireEvent.change(input, { target: { value: "EXISTING@EXAMPLE.COM" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockOnChange).not.toHaveBeenCalled();
    expect(screen.getByText("This guest has already been added")).toBeInTheDocument();
  });
});
