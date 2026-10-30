import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  ExportBookingsCSVButton,
  ExportBookingsExcelButton,
} from "@/components/bookings/ExportBookingsCSVButton";
import * as csvExportModule from "@/lib/venueBookingCsvExport";

jest.mock("@/lib/venueBookingCsvExport", () => ({
  downloadBookingsCSV: jest.fn(),
  downloadBookingsExcel: jest.fn(),
}));

describe("ExportBookingsCSVButton & ExportBookingsExcelButton", () => {
  const mockBookings = [
    {
      id: "booking-1",
      venueName: "Silicon Hub",
      deskName: "Hot Desk 4",
      date: "2026-10-30",
      startTime: "09:00",
      endTime: "17:00",
      duration: "8 hours",
      totalPrice: 25,
      currency: "USD",
      status: "confirmed" as const,
      paymentStatus: "paid" as const,
    },
    {
      id: "booking-2",
      venueName: "Silicon Hub",
      deskName: "Dedicated Pod 2",
      date: "2026-10-31",
      startTime: "10:00",
      endTime: "18:00",
      duration: "8 hours",
      totalPrice: 35,
      currency: "USD",
      status: "completed" as const,
      paymentStatus: "paid" as const,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  it("renders default CSV button and triggers downloadBookingsCSV on click", () => {
    const onExport = jest.fn();

    render(
      <ExportBookingsCSVButton
        bookings={mockBookings}
        venueName="Silicon Hub"
        filename="oct-bookings"
        onExport={onExport}
        testId="test-csv-btn"
      />
    );

    const button = screen.getByTestId("test-csv-btn");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "Export CSV (2 bookings)");
    expect(button).toHaveAttribute("aria-label", "Export booking history as CSV");
    expect(screen.getByTestId("test-csv-btn-label")).toHaveTextContent("Export CSV");

    fireEvent.click(button);

    expect(csvExportModule.downloadBookingsCSV).toHaveBeenCalledTimes(1);
    expect(csvExportModule.downloadBookingsCSV).toHaveBeenCalledWith(mockBookings, {
      venueName: "Silicon Hub",
      filename: "oct-bookings",
    });
    expect(onExport).toHaveBeenCalledTimes(1);

    // Shows exported state
    expect(screen.getByTestId("test-csv-btn-success-label")).toHaveTextContent("Exported");
    expect(screen.getByTestId("test-csv-btn-success-icon")).toBeInTheDocument();

    // After 2500ms, reverts back
    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(screen.getByTestId("test-csv-btn-label")).toHaveTextContent("Export CSV");
  });

  it("renders ExportBookingsExcelButton and triggers downloadBookingsExcel on click", () => {
    const onExport = jest.fn();

    render(
      <ExportBookingsExcelButton
        bookings={mockBookings}
        venueName="Silicon Hub"
        onExport={onExport}
        testId="test-excel-btn"
      />
    );

    const button = screen.getByTestId("test-excel-btn");
    expect(button).toHaveAttribute("title", "Export Excel (.xlsx) (2 bookings)");
    expect(button).toHaveAttribute("aria-label", "Export booking history as Excel");
    expect(screen.getByTestId("test-excel-btn-label")).toHaveTextContent("Export Excel (.xlsx)");

    fireEvent.click(button);

    expect(csvExportModule.downloadBookingsExcel).toHaveBeenCalledTimes(1);
    expect(csvExportModule.downloadBookingsExcel).toHaveBeenCalledWith(mockBookings, {
      venueName: "Silicon Hub",
      filename: undefined,
    });
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("defensively handles null or undefined bookings prop without throwing", () => {
    // @ts-expect-error testing invalid prop runtime safety
    render(<ExportBookingsCSVButton bookings={null} testId="null-bookings-btn" />);

    const button = screen.getByTestId("null-bookings-btn");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", "No bookings available to export");

    fireEvent.click(button);
    expect(csvExportModule.downloadBookingsCSV).not.toHaveBeenCalled();
  });

  it("disables button when bookings array is empty", () => {
    render(<ExportBookingsCSVButton bookings={[]} testId="empty-bookings-btn" />);

    const button = screen.getByTestId("empty-bookings-btn");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "No bookings available to export");

    fireEvent.click(button);
    expect(csvExportModule.downloadBookingsCSV).not.toHaveBeenCalled();
  });

  it("respects explicit disabled prop", () => {
    render(
      <ExportBookingsCSVButton
        bookings={mockBookings}
        disabled={true}
        testId="disabled-btn"
      />
    );

    const button = screen.getByTestId("disabled-btn");
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(csvExportModule.downloadBookingsCSV).not.toHaveBeenCalled();
  });

  it("catches errors in download function and invokes onError callback", () => {
    (csvExportModule.downloadBookingsCSV as jest.Mock).mockImplementationOnce(() => {
      throw new Error("Disk quota exceeded");
    });

    const onError = jest.fn();

    render(
      <ExportBookingsCSVButton
        bookings={mockBookings}
        onError={onError}
        testId="error-btn"
      />
    );

    fireEvent.click(screen.getByTestId("error-btn"));

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("Disk quota exceeded");
  });

  it("supports compact variant and custom className", () => {
    render(
      <ExportBookingsCSVButton
        bookings={mockBookings}
        variant="compact"
        className="custom-export-class"
        testId="compact-btn"
      />
    );

    const button = screen.getByTestId("compact-btn");
    expect(button).toHaveClass("custom-export-class");
    expect(screen.getByTestId("compact-btn-download-icon")).toBeInTheDocument();
  });

  it("clears timeout safely when unmounted during downloaded state", () => {
    const { unmount } = render(
      <ExportBookingsCSVButton bookings={mockBookings} testId="unmount-btn" />
    );

    fireEvent.click(screen.getByTestId("unmount-btn"));
    expect(screen.getByTestId("unmount-btn-success-label")).toBeInTheDocument();

    // Unmount before timer finishes
    unmount();
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    // Should not throw or warn
  });
});
