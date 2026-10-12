import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  RescheduleModal,
  generateRescheduledICS,
} from "@/components/bookings/RescheduleModal";

describe("RescheduleModal Component", () => {
  const mockBooking = {
    id: "booking-1",
    confirmationId: "WS-CONF-888",
    date: "2026-10-20",
    time: "10:00",
    duration: 60,
    seatNumber: "A4",
    seatId: "seat-4",
    venue: {
      name: "Indie Hub",
      address: "123 Tech Lane",
    },
  };

  const mockOnClose = jest.fn();
  const mockOnSuccess = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <RescheduleModal
        booking={mockBooking}
        isOpen={false}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders booking details when open", () => {
    render(
      <RescheduleModal
        booking={mockBooking}
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />,
    );

    expect(
      screen.getByText(/Reschedule \/ Extend Booking/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Indie Hub/i)).toBeInTheDocument();
    expect(screen.getByText(/WS-CONF-888/i)).toBeInTheDocument();
    expect(screen.getByTestId("reschedule-date-input")).toHaveValue(
      "2026-10-20",
    );
    expect(screen.getByTestId("reschedule-time-input")).toHaveValue("10:00");
  });

  it("updates duration when quick extend buttons are clicked", () => {
    render(
      <RescheduleModal
        booking={mockBooking}
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />,
    );

    const extend30Btn = screen.getByTestId("quick-extend-30m");
    fireEvent.click(extend30Btn);
    expect(screen.getByText(/90 min/i)).toBeInTheDocument();

    const extend1hBtn = screen.getByTestId("quick-extend-1h");
    fireEvent.click(extend1hBtn);
    expect(screen.getByText(/150 min/i)).toBeInTheDocument();
  });

  it("submits PATCH request and triggers onSuccess callback", async () => {
    const originalFetch = global.fetch;
    const mockUpdatedBooking = {
      ...mockBooking,
      date: "2026-10-22",
      time: "11:00",
      duration: 120,
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        booking: mockUpdatedBooking,
      }),
    });

    render(
      <RescheduleModal
        booking={mockBooking}
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />,
    );

    const dateInput = screen.getByTestId("reschedule-date-input");
    const timeInput = screen.getByTestId("reschedule-time-input");
    const submitBtn = screen.getByTestId("reschedule-submit-button");

    fireEvent.change(dateInput, { target: { value: "2026-10-22" } });
    fireEvent.change(timeInput, { target: { value: "11:00" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/bookings/booking-1",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining('"date":"2026-10-22"'),
        }),
      );
      expect(mockOnSuccess).toHaveBeenCalledWith(mockUpdatedBooking);
    });

    global.fetch = originalFetch;
  });

  it("displays error message when API returns failure", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "The requested time slot or desk is not available.",
      }),
    });

    render(
      <RescheduleModal
        booking={mockBooking}
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />,
    );

    const submitBtn = screen.getByTestId("reschedule-submit-button");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/The requested time slot or desk is not available/i),
      ).toBeInTheDocument();
    });

    global.fetch = originalFetch;
  });

  describe("Add to Calendar (.ics) on Reschedule Success Step", () => {
    it("generates valid RFC 5545 .ics content including venue name, location, booking reference, and reminder alarm", () => {
      const ics = generateRescheduledICS(
        mockBooking,
        "2026-10-25",
        "14:00",
        90,
        15,
      );

      // RFC 5545 structure
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("VERSION:2.0");
      expect(ics).toContain("PRODID:-//WorkSphere//EN");
      expect(ics).toContain("BEGIN:VEVENT");
      expect(ics).toContain("STATUS:CONFIRMED");
      expect(ics).toContain("END:VEVENT");
      expect(ics).toContain("END:VCALENDAR");
      expect(ics.includes("\r\n")).toBe(true);

      // Venue name & location & booking reference
      expect(ics).toContain("Indie Hub");
      expect(ics).toContain("LOCATION:123 Tech Lane");
      expect(ics).toContain("WS-CONF-888");

      // Reminder alarm
      expect(ics).toContain("BEGIN:VALARM");
      expect(ics).toContain("TRIGGER:-PT15M");
      expect(ics).toContain("ACTION:DISPLAY");
      expect(ics).toContain("DESCRIPTION:Reminder:");
      expect(ics).toContain("END:VALARM");
    });

    it("displays the reschedule success step and triggers client-side .ics download via Blob URL", async () => {
      const originalFetch = global.fetch;
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          booking: {
            ...mockBooking,
            date: "2026-10-25",
            time: "14:00",
            duration: 90,
          },
        }),
      });

      URL.createObjectURL = jest.fn(
        () => "blob:http://localhost/mock-rescheduled-ics",
      );
      URL.revokeObjectURL = jest.fn();

      const mockClick = jest.fn();
      const originalCreateElement = document.createElement.bind(document);
      jest
        .spyOn(document, "createElement")
        .mockImplementation((tagName: string) => {
          const el = originalCreateElement(tagName);
          if (tagName === "a") {
            el.click = mockClick;
          }
          return el;
        });

      render(
        <RescheduleModal
          booking={mockBooking}
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />,
      );

      // Submit reschedule
      const dateInput = screen.getByTestId("reschedule-date-input");
      const timeInput = screen.getByTestId("reschedule-time-input");
      fireEvent.change(dateInput, { target: { value: "2026-10-25" } });
      fireEvent.change(timeInput, { target: { value: "14:00" } });
      fireEvent.click(screen.getByTestId("reschedule-submit-button"));

      // Verify success step is shown
      await waitFor(() => {
        expect(
          screen.getByTestId("reschedule-success-step"),
        ).toBeInTheDocument();
      });

      expect(screen.getByText(/Booking Rescheduled!/i)).toBeInTheDocument();
      expect(screen.getByText("Add to Calendar (.ics)")).toBeInTheDocument();
      expect(screen.getByText("123 Tech Lane")).toBeInTheDocument();
      expect(screen.getByText("WS-CONF-888")).toBeInTheDocument();

      // Click Add to Calendar (.ics)
      const downloadBtn = screen.getByTestId("add-to-calendar-ics-btn");
      fireEvent.click(downloadBtn);

      // Verify Blob URL creation and download trigger
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(mockClick).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:http://localhost/mock-rescheduled-ics",
      );

      // Verify Done button closes modal
      const doneBtn = screen.getByTestId("reschedule-done-btn");
      fireEvent.click(doneBtn);
      expect(mockOnClose).toHaveBeenCalled();

      global.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      jest.restoreAllMocks();
    });
  });
});
