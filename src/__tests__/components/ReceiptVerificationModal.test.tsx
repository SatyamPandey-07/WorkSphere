import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BookingModal } from "@/components/chat/BookingModal";

jest.mock("@/lib/analytics", () => ({ trackEvent: jest.fn() }));
jest.mock("canvas-confetti", () => jest.fn());

jest.mock("@/components/receipt/ReceiptVerificationModal", () => ({
  ReceiptVerificationModal: function MockReceiptVerificationModal() {
    return <div data-testid="mock-receipt-modal" />;
  },
}));

jest.mock("@/components/receipt/SignatureVerificationBadge", () => ({
  SignatureVerificationBadge: function MockBadge({ status, className }: any) {
    return (
      <div data-testid="sig-badge" data-status={status} className={className}>
        {status === "verified"
          ? "Digitally Verified"
          : status === "invalid"
            ? "Signature Invalid"
            : status === "verifying"
              ? "Verifying Signature..."
              : "Awaiting Verification"}
      </div>
    );
  },
}));

jest.mock("@/hooks/usePdfSignatureVerifier", () => ({
  usePdfSignatureVerifier: () => ({
    status: "idle",
    progress: 0,
    signatures: [],
    result: null,
    error: null,
    verify: jest.fn(),
    reset: jest.fn(),
  }),
}));

jest.mock("@/components/GuestsInput", () => {
  return function MockGuestsInput() {
    return <div data-testid="mock-guests-input">Guests Input</div>;
  };
});

const mockBookings = [
  {
    id: "booking-1",
    confirmationId: "CNF-001",
    date: "2026-07-20",
    time: "10:00",
    venue: {
      name: "Cafe Coffee Day",
      category: "cafe",
      address: "123 Main St",
    },
    createdAt: "2026-07-19T10:00:00Z",
    duration: 2,
  },
  {
    id: "booking-2",
    confirmationId: "CNF-002",
    date: "2026-07-21",
    time: "14:00",
    venue: {
      name: "WorkHub Downtown",
      category: "coworking",
      address: "456 Oak Ave",
    },
    createdAt: "2026-07-20T10:00:00Z",
    duration: 3,
  },
];

describe("ReceiptVerificationBadge in Booking History", () => {
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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bookings: mockBookings }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("opens history mode when mode prop is history", async () => {
    render(
      <BookingModal
        isOpen={true}
        onClose={mockOnClose}
        venue={mockVenue}
        mode="history"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Booking History")).toBeInTheDocument();
    });
  });

  it("renders SignatureVerificationBadge for each booking in history", async () => {
    render(
      <BookingModal
        isOpen={true}
        onClose={mockOnClose}
        venue={mockVenue}
        mode="history"
      />,
    );

    await waitFor(() => {
      const badges = screen.getAllByTestId("sig-badge");
      expect(badges.length).toBe(mockBookings.length);
    });
  });

  it("shows all booking confirmation IDs in history view", async () => {
    render(
      <BookingModal
        isOpen={true}
        onClose={mockOnClose}
        venue={mockVenue}
        mode="history"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("CNF-001")).toBeInTheDocument();
      expect(screen.getByText("CNF-002")).toBeInTheDocument();
    });
  });

  it("renders Download Receipt buttons for each booking", async () => {
    render(
      <BookingModal
        isOpen={true}
        onClose={mockOnClose}
        venue={mockVenue}
        mode="history"
      />,
    );

    await waitFor(() => {
      const buttons = screen.getAllByText("Download Receipt");
      expect(buttons.length).toBe(mockBookings.length);
    });
  });
});
