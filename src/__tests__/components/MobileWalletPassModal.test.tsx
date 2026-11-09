import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MobileWalletPassModal } from "@/components/bookings/MobileWalletPassModal";

const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("MobileWalletPassModal Component - Clipboard Copy Handling (#4785)", () => {
  const mockBooking = {
    id: "booking-123",
    confirmationId: "WS-CONF-123",
    date: "2026-10-20",
    time: "10:00 AM",
    venueId: "venue-1",
    seatNumber: "4A",
    status: "CONFIRMED",
    venue: {
      id: "venue-1",
      name: "Downtown Innovation Center",
      address: "123 Market St, Suite 400",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        googleWallet: {
          saveUrl: "https://pay.google.com/gp/v/save/mock-jwt",
        },
      }),
    });
  });

  it("copies pass URL to clipboard successfully when clipboard access is allowed", async () => {
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(
      <MobileWalletPassModal
        booking={mockBooking as any}
        isOpen={true}
        onClose={jest.fn()}
      />,
    );

    const copyBtn = screen.getByTestId("copy-wallet-pass-url-btn");
    expect(copyBtn).toBeInTheDocument();
    expect(screen.getByText("Copy Pass URL")).toBeInTheDocument();

    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith(
        expect.stringContaining("/api/bookings/booking-123/wallet/apple"),
      );
      expect(screen.getByText("Pass URL Copied!")).toBeInTheDocument();
      expect(mockToast).toHaveBeenCalledWith(
        "Pass URL copied to clipboard!",
        "success",
      );
    });
  });

  it("catches clipboard permission rejection gracefully and falls back to selectable text field and error toast", async () => {
    const mockWriteText = jest
      .fn()
      .mockRejectedValue(new Error("NotAllowedError: Clipboard permission denied"));
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(
      <MobileWalletPassModal
        booking={mockBooking as any}
        isOpen={true}
        onClose={jest.fn()}
      />,
    );

    const copyBtn = screen.getByTestId("copy-wallet-pass-url-btn");
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalled();
      // Should show error toast
      expect(mockToast).toHaveBeenCalledWith(
        "Unable to copy to clipboard. Please copy manually.",
        "error",
      );
      // Fallback container should become visible
      expect(
        screen.getByTestId("clipboard-fallback-container"),
      ).toBeInTheDocument();
      // Fallback input should contain pass URL and be selectable
      const fallbackInput = screen.getByTestId(
        "fallback-pass-url-input",
      ) as HTMLInputElement;
      expect(fallbackInput).toBeInTheDocument();
      expect(fallbackInput.value).toContain(
        "/api/bookings/booking-123/wallet/apple",
      );
    });
  });
});
