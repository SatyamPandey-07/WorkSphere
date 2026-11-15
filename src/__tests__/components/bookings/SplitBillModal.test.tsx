import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SplitBillModal } from "@/components/bookings/SplitBillModal";
import type { BookingSummary } from "@/components/bookings/BookingList";

describe("SplitBillModal Component", () => {
  const mockBooking: BookingSummary = {
    id: "booking-split-123",
    confirmationId: "CONF-9921",
    date: "2026-11-05",
    time: "10:00",
    createdAt: "2026-10-30T10:00:00Z",
    venue: {
      id: "venue-42",
      name: "CyberWorks Hub",
      address: "404 Innovation Way",
    },
  };

  const mockSplitData = {
    bookingId: "booking-split-123",
    venueName: "CyberWorks Hub",
    totalAmount: 60,
    currency: "USD",
    hostShare: 20,
    totalGuests: 2,
    paidCount: 1,
    allPaid: false,
    guestShares: [
      {
        guestId: "guest-1",
        email: "alice@example.com",
        name: "Alice Nomad",
        amount: 20,
        paid: true,
        paymentToken: "token-1",
        paymentUrl: "https://worksphere.app/pay/token-1",
        shareLinks: {
          whatsapp: "https://wa.me/?text=Pay+Here",
          email: "mailto:alice@example.com?subject=Split",
          copy: "https://worksphere.app/pay/token-1",
        },
      },
      {
        guestId: "guest-2",
        email: "bob@example.com",
        name: "Bob Explorer",
        amount: 20,
        paid: false,
        paymentToken: "token-2",
        paymentUrl: "https://worksphere.app/pay/token-2",
        shareLinks: {
          whatsapp: "https://wa.me/?text=Pay+Bob",
          email: "mailto:bob@example.com?subject=Split",
          copy: "https://worksphere.app/pay/token-2",
        },
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <SplitBillModal booking={mockBooking} isOpen={false} onClose={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders loading state while fetching split bill data", async () => {
    let resolvePromise: any;
    (global.fetch as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
    );

    render(
      <SplitBillModal booking={mockBooking} isOpen={true} onClose={jest.fn()} />
    );

    expect(screen.getByTestId("split-bill-loading")).toBeInTheDocument();
    expect(
      screen.getByText("Calculating auto-payment split links...")
    ).toBeInTheDocument();

    await act(async () => {
      resolvePromise({ ok: true, json: async () => ({ split: null }) });
    });
  });

  it("renders error state when fetch returns an error", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Booking not found or not eligible" }),
    });

    render(
      <SplitBillModal booking={mockBooking} isOpen={true} onClose={jest.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("split-bill-error")).toBeInTheDocument();
      expect(
        screen.getByText("Booking not found or not eligible")
      ).toBeInTheDocument();
    });
  });

  it("renders error when booking has no id", async () => {
    const invalidBooking = { ...mockBooking, id: "" };
    render(
      <SplitBillModal
        booking={invalidBooking}
        isOpen={true}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("split-bill-error")).toBeInTheDocument();
      expect(
        screen.getByText("No booking details provided")
      ).toBeInTheDocument();
    });
  });

  it("successfully renders split bill information and guest shares", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ split: mockSplitData }),
    });

    render(
      <SplitBillModal booking={mockBooking} isOpen={true} onClose={jest.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("Split Bill & Guest Passes")).toBeInTheDocument();
      expect(screen.getByText(/CyberWorks Hub · 2026-11-05/)).toBeInTheDocument();
      expect(screen.getByTestId("split-bill-host-share")).toHaveTextContent("$20.00 USD");
      expect(screen.getByText("1/2 Paid")).toBeInTheDocument();
    });

    expect(screen.getByText("Alice Nomad")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Paid & Confirmed")).toBeInTheDocument();

    expect(screen.getByText("Bob Explorer")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("Pending Payment")).toBeInTheDocument();
  });

  it("renders empty guest state when no guests are present in split data", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        split: {
          ...mockSplitData,
          guestShares: [],
          totalGuests: 0,
          paidCount: 0,
        },
      }),
    });

    render(
      <SplitBillModal booking={mockBooking} isOpen={true} onClose={jest.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("split-bill-empty-guests")).toBeInTheDocument();
      expect(
        screen.getByText("No guests added to this booking yet")
      ).toBeInTheDocument();
    });
  });

  it("handles total amount change and sends update request", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ split: mockSplitData }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          split: {
            ...mockSplitData,
            totalAmount: 90,
            hostShare: 30,
          },
        }),
      });

    render(
      <SplitBillModal booking={mockBooking} isOpen={true} onClose={jest.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("split-bill-total-input")).toBeInTheDocument();
    });

    const totalInput = screen.getByTestId("split-bill-total-input");
    fireEvent.change(totalInput, { target: { value: "90" } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/bookings/booking-split-123/split-bill",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ totalAmount: 90 }),
        })
      );
      expect(screen.getByTestId("split-bill-host-share")).toHaveTextContent("$30.00 USD");
    });
  });

  it("ignores invalid or negative total amount inputs", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ split: mockSplitData }),
    });

    render(
      <SplitBillModal booking={mockBooking} isOpen={true} onClose={jest.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("split-bill-total-input")).toBeInTheDocument();
    });

    const totalInput = screen.getByTestId("split-bill-total-input");
    fireEvent.change(totalInput, { target: { value: "-10" } });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("copies payment URL and shows copied feedback", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ split: mockSplitData }),
    });

    render(
      <SplitBillModal booking={mockBooking} isOpen={true} onClose={jest.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("copy-btn-guest-1")).toBeInTheDocument();
    });

    const copyBtn = screen.getByTestId("copy-btn-guest-1");
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://worksphere.app/pay/token-1"
    );
    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });

  it("calls onClose when close button or Done button is clicked", async () => {
    const handleClose = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ split: mockSplitData }),
    });

    render(
      <SplitBillModal booking={mockBooking} isOpen={true} onClose={handleClose} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("split-bill-close-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("split-bill-close-btn"));
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("split-bill-done-btn"));
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it("calls onClose on Escape key press", async () => {
    const handleClose = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ split: mockSplitData }),
    });

    render(
      <SplitBillModal booking={mockBooking} isOpen={true} onClose={handleClose} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("split-bill-modal")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on backdrop click and preserves click isolation on container", async () => {
    const handleClose = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ split: mockSplitData }),
    });

    render(
      <SplitBillModal
        booking={mockBooking}
        isOpen={true}
        onClose={handleClose}
        className="custom-modal-root"
        testId="custom-split-modal"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("custom-split-modal")).toBeInTheDocument();
    });

    const backdrop = screen.getByTestId("custom-split-modal");
    expect(backdrop.className).toContain("custom-modal-root");

    // Click container inside dialog
    fireEvent.click(screen.getByText("Split Bill & Guest Passes"));
    expect(handleClose).not.toHaveBeenCalled();

    // Click backdrop
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
