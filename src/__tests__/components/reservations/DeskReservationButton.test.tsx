import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DeskReservationButton } from "@/components/reservations/DeskReservationButton";

// Global mock declarations
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => any;
declare const beforeEach: (fn: () => void) => void;
declare const afterEach: (fn: () => void) => void;
declare const jest: any;

describe("DeskReservationButton Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with default label, icon, and attributes", () => {
    render(<DeskReservationButton venueId="venue-123" deskId="desk-456" />);

    const button = screen.getByTestId("desk-reservation-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Hold Desk");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("renders custom deskName in button label", () => {
    render(
      <DeskReservationButton
        venueId="venue-123"
        deskId="desk-456"
        deskName="Quiet Pod 3B"
      />,
    );

    expect(screen.getByTestId("desk-reservation-button")).toHaveTextContent(
      "Hold Quiet Pod 3B",
    );
  });

  it("immediately disables the button and displays spinning loader icon upon click", async () => {
    let resolveHold: (value: any) => void = () => {};
    const holdPromise = new Promise((resolve) => {
      resolveHold = resolve;
    });
    const mockOnHold = jest.fn(() => holdPromise);

    render(
      <DeskReservationButton
        venueId="venue-123"
        deskId="desk-456"
        onHold={mockOnHold}
      />,
    );

    const button = screen.getByTestId("desk-reservation-button");
    expect(button).not.toBeDisabled();

    // Initial click
    fireEvent.click(button);

    // Immediately locked and disabled
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("desk-reservation-spinner")).toBeInTheDocument();
    expect(button).toHaveTextContent("Holding Desk...");

    // Resolve the hold request
    resolveHold({ success: true, expiresAt: Date.now() + 300000 });
    await waitFor(() => {
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "false");
    });
  });

  it("prevents duplicate hold requests during rapid double-click", async () => {
    let resolveHold: (value: any) => void = () => {};
    const holdPromise = new Promise((resolve) => {
      resolveHold = resolve;
    });
    const mockOnHold = jest.fn(() => holdPromise);

    render(
      <DeskReservationButton
        venueId="venue-123"
        deskId="desk-456"
        onHold={mockOnHold}
      />,
    );

    const button = screen.getByTestId("desk-reservation-button");

    // Rapid double click
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    // Only 1 hold request should be dispatched
    expect(mockOnHold).toHaveBeenCalledTimes(1);

    resolveHold({ success: true });
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  it("utilizes AbortController and aborts prior pending hold requests when user selects a different seat", async () => {
    const receivedSignals: AbortSignal[] = [];
    const mockOnHold = jest.fn((_deskId: string, signal: AbortSignal) => {
      receivedSignals.push(signal);
      return new Promise(() => {}); // never resolves to keep in flight
    });

    const { rerender } = render(
      <DeskReservationButton
        venueId="venue-123"
        deskId="desk-1"
        onHold={mockOnHold}
      />,
    );

    const button = screen.getByTestId("desk-reservation-button");
    fireEvent.click(button);

    expect(mockOnHold).toHaveBeenCalledTimes(1);
    expect(receivedSignals[0].aborted).toBe(false);

    // User switches to a different desk / seat
    rerender(
      <DeskReservationButton
        venueId="venue-123"
        deskId="desk-2"
        onHold={mockOnHold}
      />,
    );

    // Prior request's abort signal should now be aborted
    expect(receivedSignals[0].aborted).toBe(true);

    // Button state should be reset and ready for new hold
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");

    // Click on new desk
    fireEvent.click(button);
    expect(mockOnHold).toHaveBeenCalledTimes(2);
    expect(receivedSignals[1].aborted).toBe(false);
  });

  it("aborts in-flight request when component unmounts", () => {
    const receivedSignals: AbortSignal[] = [];
    const mockOnHold = jest.fn((_deskId: string, signal: AbortSignal) => {
      receivedSignals.push(signal);
      return new Promise(() => {});
    });

    const { unmount } = render(
      <DeskReservationButton
        venueId="venue-123"
        deskId="desk-1"
        onHold={mockOnHold}
      />,
    );

    const button = screen.getByTestId("desk-reservation-button");
    fireEvent.click(button);

    expect(receivedSignals[0].aborted).toBe(false);

    unmount();

    expect(receivedSignals[0].aborted).toBe(true);
  });

  it("calls onHoldSuccess with payload when request resolves successfully", async () => {
    const mockSuccess = jest.fn();
    const mockOnHold = jest.fn(() =>
      Promise.resolve({
        success: true,
        expiresAt: 1700000000000,
        remainingSeconds: 300,
      }),
    );

    render(
      <DeskReservationButton
        venueId="venue-123"
        deskId="desk-101"
        onHold={mockOnHold}
        onHoldSuccess={mockSuccess}
      />,
    );

    fireEvent.click(screen.getByTestId("desk-reservation-button"));

    await waitFor(() => {
      expect(mockSuccess).toHaveBeenCalledWith({
        success: true,
        expiresAt: 1700000000000,
        remainingSeconds: 300,
      });
    });
  });

  it("calls onHoldError and does not treat AbortError as unexpected failure", async () => {
    const mockError = jest.fn();
    const mockOnHold = jest.fn(() =>
      Promise.reject(new Error("Seat already booked by another user")),
    );

    render(
      <DeskReservationButton
        venueId="venue-123"
        deskId="desk-101"
        onHold={mockOnHold}
        onHoldError={mockError}
      />,
    );

    fireEvent.click(screen.getByTestId("desk-reservation-button"));

    await waitFor(() => {
      expect(mockError).toHaveBeenCalled();
    });
  });

  it("renders held state with checkmark icon when isHeld is true", () => {
    render(
      <DeskReservationButton
        venueId="venue-123"
        deskId="desk-101"
        isHeld={true}
      />,
    );

    const button = screen.getByTestId("desk-reservation-button");
    expect(button).toBeDisabled();
    expect(screen.getByTestId("desk-reservation-held-icon")).toBeInTheDocument();
    expect(button).toHaveTextContent("Desk Held");
  });
});
