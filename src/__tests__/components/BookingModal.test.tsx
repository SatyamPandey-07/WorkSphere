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

    expect(screen.getByText("Book a workspace")).toBeInTheDocument();
    expect(screen.getByText("Cafe Coffee Day")).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
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

    expect(screen.getByText("You're booked!")).toBeInTheDocument();
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

    expect(screen.getByText("You're booked!")).toBeInTheDocument();
    expect(confetti).not.toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
  });

  describe("Time picker validation (#4375)", () => {
    it("auto-advances end time by 1 hour when start time is selected", () => {
      render(
        <BookingModal
          isOpen={true}
          onClose={mockOnClose}
          venue={mockVenue}
          mode="booking"
        />,
      );

      const startTimeInput = screen.getByTestId("booking-start-time");
      const endTimeInput = screen.getByTestId("booking-end-time");

      fireEvent.change(startTimeInput, { target: { value: "10:00" } });
      expect(endTimeInput).toHaveValue("11:00");
    });

    it("displays validation warning if end time is earlier than start time", () => {
      render(
        <BookingModal
          isOpen={true}
          onClose={mockOnClose}
          venue={mockVenue}
          mode="booking"
        />,
      );

      const startTimeInput = screen.getByTestId("booking-start-time");
      const endTimeInput = screen.getByTestId("booking-end-time");

      fireEvent.change(startTimeInput, { target: { value: "14:00" } });
      fireEvent.change(endTimeInput, { target: { value: "12:00" } });

      expect(
        screen.getByText("End time must be after start time."),
      ).toBeInTheDocument();
    });

    it("clears validation warning once valid end time is selected", () => {
      render(
        <BookingModal
          isOpen={true}
          onClose={mockOnClose}
          venue={mockVenue}
          mode="booking"
        />,
      );

      const startTimeInput = screen.getByTestId("booking-start-time");
      const endTimeInput = screen.getByTestId("booking-end-time");

      fireEvent.change(startTimeInput, { target: { value: "14:00" } });
      fireEvent.change(endTimeInput, { target: { value: "12:00" } });
      expect(
        screen.getByText("End time must be after start time."),
      ).toBeInTheDocument();

      fireEvent.change(endTimeInput, { target: { value: "16:00" } });
      expect(
        screen.queryByText("End time must be after start time."),
      ).not.toBeInTheDocument();
    });

    it("prevents double-click submission and does not issue duplicate booking POST requests (#4368)", async () => {
      const originalFetch = global.fetch;
      const mockFetch = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({ confirmationId: "conf-123" }),
                }),
              100,
            ),
          ),
      );
      global.fetch = mockFetch;

      render(
        <BookingModal
          isOpen={true}
          onClose={mockOnClose}
          venue={mockVenue}
          mode="booking"
        />,
      );

      const dateInput = screen.getByLabelText("Date");
      const startTimeInput = screen.getByTestId("booking-start-time");
      const emailInput = screen.getByLabelText("Confirmation email");
      const submitBtn = screen.getByRole("button", { name: /confirm booking/i });

      fireEvent.change(dateInput, { target: { value: "2026-10-10" } });
      fireEvent.change(startTimeInput, { target: { value: "10:00" } });
      fireEvent.change(emailInput, { target: { value: "user@example.com" } });

      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      global.fetch = originalFetch;
    });
  });

  describe("Quick Duration Selector (#4406)", () => {
    it("renders quick duration preset chips (30m, 1h, 2h, 4h, Full Day)", () => {
      render(
        <BookingModal
          isOpen={true}
          onClose={mockOnClose}
          venue={mockVenue}
          mode="booking"
        />,
      );

      expect(screen.getByText("Quick duration")).toBeInTheDocument();
      expect(screen.getByTestId("duration-preset-30m")).toBeInTheDocument();
      expect(screen.getByTestId("duration-preset-1h")).toBeInTheDocument();
      expect(screen.getByTestId("duration-preset-2h")).toBeInTheDocument();
      expect(screen.getByTestId("duration-preset-4h")).toBeInTheDocument();
      expect(screen.getByTestId("duration-preset-full-day")).toBeInTheDocument();
    });

    it("updates end time dynamically when a duration chip is clicked", () => {
      render(
        <BookingModal
          isOpen={true}
          onClose={mockOnClose}
          venue={mockVenue}
          mode="booking"
        />,
      );

      const startTimeInput = screen.getByTestId("booking-start-time");
      const endTimeInput = screen.getByTestId("booking-end-time");

      fireEvent.change(startTimeInput, { target: { value: "10:00" } });

      // Click 2h preset
      fireEvent.click(screen.getByTestId("duration-preset-2h"));
      expect(endTimeInput).toHaveValue("12:00");

      // Click 4h preset
      fireEvent.click(screen.getByTestId("duration-preset-4h"));
      expect(endTimeInput).toHaveValue("14:00");

      // Click Full Day preset (8h)
      fireEvent.click(screen.getByTestId("duration-preset-full-day"));
      expect(endTimeInput).toHaveValue("18:00");
    });
  });

  describe("Calendar Quick Action Dropdown (#4595)", () => {
    it("renders calendar quick action dropdown in booking confirmation dialog and allows opening Google/Outlook links and downloading .ics", async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          confirmationId: "CONF-TEST-99",
          bookingId: "book-123",
        }),
      });

      render(
        <BookingModal
          isOpen={true}
          onClose={mockOnClose}
          venue={mockVenue}
          mode="booking"
        />,
      );

      const dateInput = screen.getByLabelText("Date");
      const startTimeInput = screen.getByTestId("booking-start-time");
      const emailInput = screen.getByLabelText("Confirmation email");
      const submitBtn = screen.getByRole("button", { name: /confirm booking/i });

      fireEvent.change(dateInput, { target: { value: "2026-10-10" } });
      fireEvent.change(startTimeInput, { target: { value: "10:00" } });
      fireEvent.change(emailInput, { target: { value: "user@example.com" } });
      fireEvent.click(submitBtn);

      // Verify success screen is displayed
      expect(await screen.findByText("You're booked!")).toBeInTheDocument();

      // Verify Calendar Quick Add dropdown button is rendered
      const dropdownBtn = screen.getByTestId("calendar-quick-add-btn");
      expect(dropdownBtn).toBeInTheDocument();
      expect(dropdownBtn).toHaveAttribute("aria-expanded", "false");

      // Dropdown menu is initially closed
      expect(screen.queryByTestId("calendar-quick-add-dropdown")).not.toBeInTheDocument();

      // Click to open dropdown
      fireEvent.click(dropdownBtn);
      expect(dropdownBtn).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("calendar-quick-add-dropdown")).toBeInTheDocument();

      // Verify Google Calendar link
      const googleLink = screen.getByTestId("add-to-google-calendar");
      expect(googleLink).toBeInTheDocument();
      expect(googleLink).toHaveAttribute("target", "_blank");
      expect(googleLink.getAttribute("href")).toContain("calendar.google.com/calendar/render");
      expect(googleLink.getAttribute("href")).toContain("action=TEMPLATE");

      // Verify Outlook link
      const outlookLink = screen.getByTestId("add-to-outlook-calendar");
      expect(outlookLink).toBeInTheDocument();
      expect(outlookLink).toHaveAttribute("target", "_blank");
      expect(outlookLink.getAttribute("href")).toContain("outlook.live.com/calendar/0/deeplink/compose");
      expect(outlookLink.getAttribute("href")).toContain("rru=addevent");

      // Verify Download (.ics) button inside dropdown
      const icsBtn = screen.getByTestId("download-ics-button");
      expect(icsBtn).toBeInTheDocument();

      global.fetch = originalFetch;
    });
  });
});
