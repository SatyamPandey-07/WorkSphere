import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BookingHistoryList } from "@/app/dashboard/BookingHistoryList";
import { BookingSummary } from "@/components/bookings/BookingList";
import { downloadICS } from "@/lib/calendar";

jest.mock("@/lib/calendar", () => ({
  ...jest.requireActual("@/lib/calendar"),
  downloadICS: jest.fn(),
}));

// A far-future date keeps the booking "upcoming" so the calendar actions show.
const booking: BookingSummary = {
  id: "booking-1",
  confirmationId: "WS-TZ-100",
  date: "2099-01-15",
  time: "10:00",
  status: "CONFIRMED",
  seatNumber: "1A",
  duration: 120,
  timeZone: "Asia/Kolkata",
  createdAt: new Date().toISOString(),
  venue: {
    name: "Workspace Hub",
    category: "coworking_space",
    address: "100 Innovation Way",
  },
};

describe("booking calendar actions use the booking's stored timezone", () => {
  beforeAll(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes timeZone to downloadICS for the .ics download", () => {
    render(<BookingHistoryList bookings={[booking]} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /download icalendar file for booking WS-TZ-100/i,
      }),
    );

    expect(downloadICS).toHaveBeenCalledWith(
      "Workspace Hub",
      "100 Innovation Way",
      "2099-01-15",
      "10:00",
      expect.objectContaining({
        durationMinutes: 120,
        confirmationId: "WS-TZ-100",
        timezone: "Asia/Kolkata",
      }),
    );
  });

  it("builds the Google Calendar link in UTC from the booking's timezone", () => {
    render(<BookingHistoryList bookings={[booking]} />);

    const link = screen.getByRole("link", { name: /google calendar/i });
    // 10:00 in Asia/Kolkata (UTC+5:30) = 04:30 UTC; 120-minute booking.
    expect(link.getAttribute("href")).toContain(
      "dates=20990115T043000Z/20990115T063000Z",
    );
  });
});
