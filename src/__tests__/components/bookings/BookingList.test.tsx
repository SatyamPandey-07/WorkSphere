import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  BookingList,
  BookingSummary,
  isUpcoming,
} from "@/components/bookings/BookingList";
import * as calendarModule from "@/lib/calendar";

jest.mock("@/lib/calendar", () => ({
  getCalendarUrls: jest.fn(() => ({
    googleUrl: "https://calendar.google.com/test",
  })),
  downloadICS: jest.fn(),
}));

jest.mock("@/components/bookings/GeoCheckInReminderBanner", () => ({
  GeoCheckInReminderBanner: () => <div data-testid="mock-geo-banner" />,
}));

jest.mock("@/components/bookings/ExportBookingsCSVButton", () => ({
  ExportBookingsCSVButton: () => <button data-testid="mock-csv-btn">Export CSV</button>,
}));

jest.mock("@/components/bookings/RescheduleModal", () => ({
  RescheduleModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="mock-reschedule-modal">
        <button onClick={onClose} data-testid="close-reschedule-btn">Close</button>
      </div>
    ) : null,
}));

jest.mock("@/components/bookings/SplitBillModal", () => ({
  SplitBillModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="mock-split-bill-modal">
        <button onClick={onClose} data-testid="close-split-bill-btn">Close</button>
      </div>
    ) : null,
}));

jest.mock("@/components/bookings/MobileWalletPassModal", () => ({
  MobileWalletPassModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="mock-wallet-modal">
        <button onClick={onClose} data-testid="close-wallet-btn">Close</button>
      </div>
    ) : null,
}));

jest.mock("@/components/bookings/CopyBookingReferenceButton", () => ({
  CopyBookingReferenceButton: ({ referenceId }: { referenceId: string }) => (
    <button data-testid={`copy-ref-${referenceId}`}>Copy</button>
  ),
}));

describe("BookingList Component", () => {
  const futureDate = "2099-12-31";
  const pastDate = "2020-01-01";

  const mockUpcomingBooking: BookingSummary = {
    id: "booking-1",
    confirmationId: "CONF-FUTURE",
    date: futureDate,
    time: "14:00",
    status: "CONFIRMED",
    seatNumber: "4A",
    duration: 120,
    timeZone: "America/New_York",
    createdAt: "2026-10-01T12:00:00Z",
    venue: {
      id: "v1",
      name: "NeoTech Workspace",
      category: "coworking",
      address: "101 Broadway",
    },
  };

  const mockPastBooking: BookingSummary = {
    id: "booking-2",
    confirmationId: "CONF-PAST",
    date: pastDate,
    time: "10:00",
    status: "CONFIRMED",
    seatNumber: "Desk 12",
    createdAt: "2020-01-01T10:00:00Z",
    venue: {
      id: "v2",
      name: "Old Cyber Cafe",
      category: "cafe",
      address: "202 Market St",
    },
  };

  const mockCancelledBooking: BookingSummary = {
    id: "booking-3",
    confirmationId: "CONF-CANCELLED",
    date: futureDate,
    time: "16:00",
    status: "CANCELLED",
    seatNumber: "Desk 9",
    createdAt: "2026-10-02T10:00:00Z",
    venue: {
      id: "v3",
      name: "Cancelled Hub",
      category: "coworking",
      address: "303 Pine St",
    },
  };

  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    window.confirm = jest.fn(() => true);
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = jest.fn();
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  describe("isUpcoming helper", () => {
    it("returns true for future date/time", () => {
      expect(isUpcoming(mockUpcomingBooking)).toBe(true);
    });

    it("returns false for past date/time", () => {
      expect(isUpcoming(mockPastBooking)).toBe(false);
    });

    it("returns false for empty or missing date/time", () => {
      expect(isUpcoming({ ...mockUpcomingBooking, date: "" })).toBe(false);
      expect(isUpcoming({ ...mockUpcomingBooking, time: "" })).toBe(false);
      expect(isUpcoming({ ...mockUpcomingBooking, date: "invalid-date" })).toBe(false);
    });
  });

  it("renders loading state when fetching bookings", () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(<BookingList />);

    expect(screen.getByTestId("booking-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading your bookings…")).toBeInTheDocument();
  });

  it("renders error state when fetch fails, and retries on clicking Try again", async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bookings: [mockUpcomingBooking] }),
      });

    render(<BookingList />);

    await waitFor(() => {
      expect(screen.getByTestId("booking-error")).toBeInTheDocument();
      expect(
        screen.getByText("We couldn't load your bookings. Please try again.")
      ).toBeInTheDocument();
    });

    const retryBtn = screen.getByTestId("booking-retry-btn");
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    await waitFor(() => {
      expect(screen.getByText("NeoTech Workspace")).toBeInTheDocument();
    });
  });

  it("renders empty state when there are no bookings", () => {
    render(<BookingList initialBookings={[]} />);

    expect(screen.getByTestId("booking-empty")).toBeInTheDocument();
    expect(screen.getByText("No bookings yet")).toBeInTheDocument();
  });

  it("renders upcoming and past bookings in separate sections and fires onCountsChange", () => {
    const handleCounts = jest.fn();

    render(
      <BookingList
        initialBookings={[
          mockUpcomingBooking,
          mockPastBooking,
          mockCancelledBooking,
        ]}
        onCountsChange={handleCounts}
        className="custom-booking-list"
        testId="custom-bookings"
      />
    );

    const container = screen.getByTestId("custom-bookings");
    expect(container).toHaveClass("custom-booking-list");

    expect(screen.getByTestId("upcoming-bookings-section")).toBeInTheDocument();
    expect(screen.getByTestId("past-bookings-section")).toBeInTheDocument();

    expect(screen.getByText("NeoTech Workspace")).toBeInTheDocument();
    expect(screen.getByText("Old Cyber Cafe")).toBeInTheDocument();
    expect(screen.getByText("Cancelled Hub")).toBeInTheDocument();

    expect(screen.getByTestId("booking-status-booking-1")).toHaveTextContent("Upcoming");
    expect(screen.getByTestId("booking-status-booking-2")).toHaveTextContent("Completed");
    expect(screen.getByTestId("booking-status-booking-3")).toHaveTextContent("Cancelled");

    expect(handleCounts).toHaveBeenCalledWith({ upcoming: 1, total: 3 });
  });

  it("handles multi-selection and bulk exports", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["csv-data"], { type: "text/csv" }),
    });

    render(
      <BookingList
        initialBookings={[mockUpcomingBooking, mockPastBooking]}
      />
    );

    expect(screen.queryByTestId("bulk-actions-toolbar")).not.toBeInTheDocument();

    // Select booking 1
    const checkbox = screen.getByTestId("booking-checkbox-booking-1");
    fireEvent.click(checkbox);

    expect(screen.getByTestId("bulk-actions-toolbar")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    const exportCsvBtn = screen.getByTestId("bulk-export-csv-btn");
    fireEvent.click(exportCsvBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/bookings/export",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ bookingIds: ["booking-1"], format: "csv" }),
        })
      );
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  it("handles cancel booking confirmation and updates booking status", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<BookingList initialBookings={[mockUpcomingBooking]} />);

    const cancelBtn = screen.getByTestId("booking-cancel-btn-booking-1");
    fireEvent.click(cancelBtn);

    expect(window.confirm).toHaveBeenCalledWith(
      `Cancel your booking at NeoTech Workspace on ${futureDate}?`
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/bookings/booking-1", {
        method: "DELETE",
      });
      expect(screen.getByTestId("booking-status-message")).toHaveTextContent(
        "Booking cancelled."
      );
    });
  });

  it("calls downloadICS when clicking Add to Calendar", () => {
    render(<BookingList initialBookings={[mockUpcomingBooking]} />);

    const icsBtn = screen.getByTestId("booking-ics-btn-booking-1");
    fireEvent.click(icsBtn);

    expect(calendarModule.downloadICS).toHaveBeenCalledWith(
      "NeoTech Workspace",
      "101 Broadway",
      futureDate,
      "14:00",
      expect.objectContaining({
        durationMinutes: 120,
        confirmationId: "CONF-FUTURE",
        timezone: "America/New_York",
      })
    );
  });

  it("opens Split Bill modal when clicking Split Bill button", () => {
    render(<BookingList initialBookings={[mockUpcomingBooking]} />);

    expect(screen.queryByTestId("mock-split-bill-modal")).not.toBeInTheDocument();

    const splitBtn = screen.getByTestId("booking-split-bill-btn-booking-1");
    fireEvent.click(splitBtn);

    expect(screen.getByTestId("mock-split-bill-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("close-split-bill-btn"));
    expect(screen.queryByTestId("mock-split-bill-modal")).not.toBeInTheDocument();
  });

  it("opens Apple / Google Pass modal when clicking pass button", () => {
    render(<BookingList initialBookings={[mockUpcomingBooking]} />);

    expect(screen.queryByTestId("mock-wallet-modal")).not.toBeInTheDocument();

    const walletBtn = screen.getByTestId("booking-wallet-pass-btn-booking-1");
    fireEvent.click(walletBtn);

    expect(screen.getByTestId("mock-wallet-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("close-wallet-btn"));
    expect(screen.queryByTestId("mock-wallet-modal")).not.toBeInTheDocument();
  });

  it("opens Reschedule modal when clicking Reschedule button", () => {
    render(<BookingList initialBookings={[mockUpcomingBooking]} />);

    expect(screen.queryByTestId("mock-reschedule-modal")).not.toBeInTheDocument();

    const rescheduleBtn = screen.getByTestId("booking-reschedule-btn-booking-1");
    fireEvent.click(rescheduleBtn);

    expect(screen.getByTestId("mock-reschedule-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("close-reschedule-btn"));
    expect(screen.queryByTestId("mock-reschedule-modal")).not.toBeInTheDocument();
  });
});
