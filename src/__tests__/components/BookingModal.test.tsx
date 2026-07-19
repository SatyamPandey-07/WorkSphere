import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BookingModal } from "@/components/chat/BookingModal";

// Mock analytics
jest.mock("@/lib/analytics", () => ({
  trackEvent: jest.fn(),
}));

// Mock canvas-confetti
jest.mock("canvas-confetti", () => jest.fn());

// Mock GuestsInput
jest.mock("@/components/GuestsInput", () => {
  return function MockGuestsInput() {
    return <div data-testid="mock-guests-input">Guests Input</div>;
  };
});

describe("BookingModal", () => {
  const mockOnClose = jest.fn();
  const mockVenue = {
    id: "venue-1",
    name: "Cafe Coffee Day",
    address: "123 Main St",
    category: "cafe",
    wifiSpeed: "100 Mbps",
    outlets: "many",
    noiseLevel: "quiet",
  } as any;

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <BookingModal isOpen={false} onClose={mockOnClose} venue={mockVenue} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the booking details step when open in booking mode", () => {
    render(
      <BookingModal isOpen={true} onClose={mockOnClose} venue={mockVenue} mode="booking" />,
    );

    expect(screen.getByText("Secure Booking")).toBeInTheDocument();
    expect(screen.getByText("Cafe Coffee Day")).toBeInTheDocument();
    expect(screen.getByLabelText("Allocation Date")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    render(
      <BookingModal isOpen={true} onClose={mockOnClose} venue={mockVenue} mode="booking" />,
    );

    const closeButton = screen.getByRole("button", { name: /close dialog/i });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
