import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VenueSeatWaitlistModal } from "@/components/venues/VenueSeatWaitlistModal";

describe("VenueSeatWaitlistModal duplicate submission prevention", () => {
  const mockOnClose = jest.fn();
  const mockOnBookingConfirmed = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("prevents duplicate waitlist submissions when button is rapidly clicked twice", async () => {
    let resolveFetch: (value: any) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith("/waitlist") && !url.includes("waitlistId")) {
        return fetchPromise;
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ entries: [] }),
      });
    });

    render(
      <VenueSeatWaitlistModal
        venueId="venue-999"
        venueName="Grand Coworking Space"
        initialDate="2026-10-10"
        initialTime="14:00"
        onClose={mockOnClose}
        onBookingConfirmed={mockOnBookingConfirmed}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /join waitlist/i })).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole("button", { name: /join waitlist/i });

    // Rapid double click
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    // Resolve fetch promise
    resolveFetch!({
      ok: true,
      json: async () => ({
        data: {
          id: "wl-123",
          status: "WAITING",
          queuePosition: 1,
          date: "2026-10-10",
          time: "14:00",
          duration: 60,
        },
        message: "Joined waitlist successfully!",
      }),
    });

    await waitFor(() => {
      expect(screen.getByText("Joined waitlist successfully!")).toBeInTheDocument();
    });

    // Verify fetch POST was called only once despite double click
    const postCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call) => call[0].endsWith("/waitlist") && call[1]?.method === "POST",
    );
    expect(postCalls.length).toBe(1);
  });

  it("prevents double-clicking seat claim button while claiming is in flight", async () => {
    let resolveClaim: (value: any) => void;
    const claimPromise = new Promise((resolve) => {
      resolveClaim = resolve;
    });

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/waitlist")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            entries: [
              {
                id: "wl-888",
                status: "NOTIFIED",
                date: "2026-10-10",
                time: "10:00",
                claimExpiresAt: new Date(Date.now() + 60000).toISOString(),
              },
            ],
          }),
        });
      }
      if (url.includes("/claim")) {
        return claimPromise;
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(
      <VenueSeatWaitlistModal
        venueId="venue-888"
        venueName="Quiet Library Lounge"
        onClose={mockOnClose}
        onBookingConfirmed={mockOnBookingConfirmed}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /claim this seat/i })).toBeInTheDocument();
    });

    const claimBtn = screen.getByRole("button", { name: /claim this seat/i });

    // Double click claim button
    fireEvent.click(claimBtn);
    fireEvent.click(claimBtn);

    resolveClaim!({
      ok: true,
      json: async () => ({
        data: { confirmationId: "CONF-777" },
      }),
    });

    await waitFor(() => {
      expect(mockOnBookingConfirmed).toHaveBeenCalledWith("CONF-777");
    });

    const claimCalls = (global.fetch as jest.Mock).mock.calls.filter((call) =>
      call[0].includes("/claim"),
    );
    expect(claimCalls.length).toBe(1);
  });
});
