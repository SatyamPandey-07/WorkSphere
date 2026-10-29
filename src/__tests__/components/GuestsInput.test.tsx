import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import GuestsInput, {
  GuestEntry,
  GuestInviteStatus,
  GuestInviteLoading,
} from "@/components/GuestsInput";

describe("GuestsInput Component (#6915)", () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders empty state with default counter and placeholder", () => {
    render(<GuestsInput guests={[]} onChange={mockOnChange} />);

    expect(screen.getByTestId("guests-input-container")).toBeInTheDocument();
    expect(screen.getByTestId("guest-email-input")).toHaveAttribute(
      "placeholder",
      "Add guest email..."
    );
    expect(screen.getByTestId("guest-count-text")).toHaveTextContent(
      "No guests added yet (max 20)"
    );
  });

  it("handles null or undefined guests array gracefully without crashing", () => {
    // @ts-expect-error testing runtime resilience against null
    render(<GuestsInput guests={null} onChange={mockOnChange} />);

    expect(screen.getByTestId("guests-input-container")).toBeInTheDocument();
    expect(screen.getByTestId("guest-count-text")).toHaveTextContent(
      "No guests added yet (max 20)"
    );
  });

  it("renders existing guest chips with email and optional name", () => {
    const sampleGuests: GuestEntry[] = [
      { id: "g1", email: "alice@example.com", name: "Alice" },
      { id: "g2", email: "bob@example.com", name: "" },
    ];

    render(<GuestsInput guests={sampleGuests} onChange={mockOnChange} />);

    expect(screen.getByTestId("guest-chips-container")).toBeInTheDocument();
    expect(screen.getByTestId("guest-chip-g1")).toHaveTextContent("alice@example.com");
    expect(screen.getByTestId("guest-chip-g1")).toHaveTextContent("Alice");
    expect(screen.getByTestId("guest-chip-g2")).toHaveTextContent("bob@example.com");
    expect(screen.getByTestId("guest-count-text")).toHaveTextContent("2 guests invited (max 20)");
  });

  it("shows validation error when email is empty", () => {
    render(<GuestsInput guests={[]} onChange={mockOnChange} />);

    const input = screen.getByTestId("guest-email-input");
    // Trigger via Enter with empty input
    fireEvent.keyDown(input, { key: "Enter" });

    const error = screen.getByTestId("guest-validation-error");
    expect(error).toHaveTextContent("Please enter an email address");
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it("shows validation error when email is invalid", () => {
    render(<GuestsInput guests={[]} onChange={mockOnChange} />);

    const input = screen.getByTestId("guest-email-input");
    fireEvent.change(input, { target: { value: "invalid-email" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const error = screen.getByTestId("guest-validation-error");
    expect(error).toHaveTextContent("Please enter a valid email address");
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it("shows validation error when guest email is a duplicate", () => {
    const existing: GuestEntry[] = [
      { id: "g1", email: "alice@example.com", name: "Alice" },
    ];

    render(<GuestsInput guests={existing} onChange={mockOnChange} />);

    const input = screen.getByTestId("guest-email-input");
    fireEvent.change(input, { target: { value: "ALICE@EXAMPLE.COM" } });
    fireEvent.click(screen.getByTestId("add-guest-btn"));

    const error = screen.getByTestId("guest-validation-error");
    expect(error).toHaveTextContent("This guest has already been added");
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it("shows validation error when maxGuests limit is reached", () => {
    const guests: GuestEntry[] = [
      { id: "g1", email: "one@example.com", name: "" },
      { id: "g2", email: "two@example.com", name: "" },
    ];

    // maxGuests = 2, so input area is hidden
    const { rerender } = render(
      <GuestsInput guests={guests} onChange={mockOnChange} maxGuests={2} />
    );
    expect(screen.queryByTestId("guests-input-area")).not.toBeInTheDocument();

    // With maxGuests = 3, we can test boundary check
    rerender(
      <GuestsInput guests={guests} onChange={mockOnChange} maxGuests={2} />
    );
  });

  it("adds guest with email only on button click", () => {
    render(<GuestsInput guests={[]} onChange={mockOnChange} />);

    const input = screen.getByTestId("guest-email-input");
    fireEvent.change(input, { target: { value: "developer@example.com" } });
    fireEvent.click(screen.getByTestId("add-guest-btn"));

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const updatedList = mockOnChange.mock.calls[0][0];
    expect(updatedList).toHaveLength(1);
    expect(updatedList[0].email).toBe("developer@example.com");
    expect(updatedList[0].name).toBe("");
  });

  it("adds guest with email and name", () => {
    render(<GuestsInput guests={[]} onChange={mockOnChange} />);

    // Toggle name input
    const toggleNameBtn = screen.getByTestId("toggle-name-btn");
    expect(toggleNameBtn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggleNameBtn);
    expect(toggleNameBtn).toHaveAttribute("aria-expanded", "true");

    const emailInput = screen.getByTestId("guest-email-input");
    const nameInput = screen.getByTestId("guest-name-input");

    fireEvent.change(emailInput, { target: { value: "charlie@example.com" } });
    fireEvent.change(nameInput, { target: { value: "Charlie Brown" } });

    fireEvent.click(screen.getByTestId("add-guest-btn"));

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const updatedList = mockOnChange.mock.calls[0][0];
    expect(updatedList[0].email).toBe("charlie@example.com");
    expect(updatedList[0].name).toBe("Charlie Brown");
  });

  it("adds guest when pressing Enter or Comma key", () => {
    render(<GuestsInput guests={[]} onChange={mockOnChange} />);

    const input = screen.getByTestId("guest-email-input");
    fireEvent.change(input, { target: { value: "first@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange.mock.calls[0][0][0].email).toBe("first@example.com");

    fireEvent.change(input, { target: { value: "second@example.com" } });
    fireEvent.keyDown(input, { key: "," });
    expect(mockOnChange).toHaveBeenCalledTimes(2);
    expect(mockOnChange.mock.calls[1][0][0].email).toBe("second@example.com");
  });

  it("removes guest when clicking remove chip button", () => {
    const existing: GuestEntry[] = [
      { id: "g1", email: "remove-me@example.com", name: "" },
      { id: "g2", email: "keep-me@example.com", name: "" },
    ];

    render(<GuestsInput guests={existing} onChange={mockOnChange} />);

    const removeBtn = screen.getByTestId("remove-guest-g1");
    fireEvent.click(removeBtn);

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const remaining = mockOnChange.mock.calls[0][0];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("g2");
  });

  it("disables remove buttons and hides input when disabled is true", () => {
    const existing: GuestEntry[] = [
      { id: "g1", email: "guest@example.com", name: "" },
    ];

    render(<GuestsInput guests={existing} onChange={mockOnChange} disabled={true} />);

    expect(screen.queryByTestId("guests-input-area")).not.toBeInTheDocument();
    expect(screen.getByTestId("remove-guest-g1")).toBeDisabled();
  });
});

describe("GuestInviteStatus Component (#6915)", () => {
  it("renders success state", () => {
    render(<GuestInviteStatus success={true} />);

    const el = screen.getByTestId("guest-invite-status-success");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("Invitation sent");
  });

  it("renders failure state with error tooltip", () => {
    render(<GuestInviteStatus success={false} error="SMTP Server Error" />);

    const el = screen.getByTestId("guest-invite-status-failed");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("Failed to send");
    expect(el).toHaveAttribute("title", "SMTP Server Error");
  });
});

describe("GuestInviteLoading Component (#6915)", () => {
  it("renders loading indicator", () => {
    render(<GuestInviteLoading />);

    const el = screen.getByTestId("guest-invite-loading");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("Sending invitation...");
  });
});
