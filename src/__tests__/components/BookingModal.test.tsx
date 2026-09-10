import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BookingModal } from "@/components/chat/BookingModal";

// Mock analytics
jest.mock("@/lib/analytics", () => ({
  trackEvent: jest.fn(),
}));

// Mock canvas-confetti
import confetti from "canvas-confetti";
jest.mock("canvas-confetti", () => jest.fn());

// Mock ReceiptVerificationModal to bypass import.meta.url issues
jest.mock("@/components/receipt/ReceiptVerificationModal", () => ({
  ReceiptVerificationModal: function MockReceiptVerificationModal() {
    return <div data-testid="mock-receipt-modal" />;
  },
}));

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
      <BookingModal
        isOpen={true}
        onClose={mockOnClose}
        venue={mockVenue}
        mode="booking"
      />,
    );

    expect(screen.getByText("Secure Booking")).toBeInTheDocument();
    expect(screen.getByText("Cafe Coffee Day")).toBeInTheDocument();
    expect(screen.getByLabelText("Allocation Date")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    render(
      <BookingModal
        isOpen={true}
        onClose={mockOnClose}
        venue={mockVenue}
        mode="booking"
      />,
    );

    const closeButton = screen.getByRole("button", { name: /close dialog/i });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("triggers celebratory confetti animation when booking is confirmed (step is success)", () => {
    (confetti as unknown as jest.Mock).mockClear();

    render(
      <BookingModal
        isOpen={true}
        onClose={mockOnClose}
        venue={mockVenue}
        initialStep="success"
      />,
    );

    expect(screen.getByText("Residency Secured")).toBeInTheDocument();
    expect(confetti).toHaveBeenCalled();
    expect(confetti).toHaveBeenCalledWith(
      expect.objectContaining({
        zIndex: 25000,
        spread: 55,
      }),
    );
  });

  it("plays confetti for a 2-second duration animation window", () => {
    jest.useFakeTimers();
    (confetti as unknown as jest.Mock).mockClear();

    const rAFCallbacks: Array<() => void> = [];
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rAFCallbacks.push(cb as () => void);
      return rAFCallbacks.length;
    });

    const now = 1000000;
    const dateSpy = jest.spyOn(Date, "now").mockReturnValue(now);

    render(
      <BookingModal
        isOpen={true}
        onClose={mockOnClose}
        venue={mockVenue}
        initialStep="success"
      />,
    );

    // Initial frame fired confetti twice (left and right cannons)
    expect(confetti).toHaveBeenCalledTimes(2);

    // Within 2 seconds (e.g. +1000ms): next frame is scheduled and fires
    dateSpy.mockReturnValue(now + 1000);
    const cb1 = rAFCallbacks.shift();
    if (cb1) cb1();
    expect(confetti).toHaveBeenCalledTimes(4);

    // Beyond 2 seconds (+2001ms): frame runs but does not schedule further animation frame
    dateSpy.mockReturnValue(now + 2001);
    const cb2 = rAFCallbacks.shift();
    if (cb2) cb2();
    expect(rAFCallbacks.length).toBe(0);

    dateSpy.mockRestore();
    (window.requestAnimationFrame as jest.Mock).mockRestore();
    jest.useRealTimers();
  });

  it("does not play confetti if user prefers reduced motion", () => {
    (confetti as unknown as jest.Mock).mockClear();

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(
      <BookingModal
        isOpen={true}
        onClose={mockOnClose}
        venue={mockVenue}
        initialStep="success"
      />,
    );

    expect(screen.getByText("Residency Secured")).toBeInTheDocument();
    expect(confetti).not.toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
  });
});
