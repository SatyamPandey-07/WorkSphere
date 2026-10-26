import {
  generateBookingsCSV,
  downloadBookingsCSV,
  generateBookingsExcel,
  downloadBookingsExcel,
  formatBookingStatus,
  BookingHistoryExportItem,
} from "@/lib/export/domain/bookingHistoryExporter";

describe("bookingHistoryExporter", () => {
  beforeAll(() => {
    global.URL.createObjectURL = jest
      .fn()
      .mockReturnValue("blob:http://localhost/mock-blob");
    global.URL.revokeObjectURL = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("formatBookingStatus", () => {
    it("formats standard statuses properly", () => {
      expect(formatBookingStatus("CONFIRMED")).toBe("Confirmed");
      expect(formatBookingStatus("confirmed")).toBe("Confirmed");
      expect(formatBookingStatus("PENDING")).toBe("Pending");
      expect(formatBookingStatus("CANCELLED")).toBe("Cancelled");
      expect(formatBookingStatus("in_review")).toBe("In_review");
    });

    it("safely handles null, undefined, or non-string inputs", () => {
      expect(formatBookingStatus(null)).toBe("Confirmed");
      expect(formatBookingStatus(undefined)).toBe("Confirmed");
      expect(formatBookingStatus("" as any)).toBe("Confirmed");
      expect(formatBookingStatus(123 as any)).toBe("Confirmed");
      expect(formatBookingStatus({} as any)).toBe("Confirmed");
    });
  });

  describe("generateBookingsCSV", () => {
    const mockBookings: BookingHistoryExportItem[] = [
      {
        id: "b1",
        confirmationId: "CONF-001",
        date: "2026-10-26",
        time: "10:00",
        duration: 90,
        seatNumber: "Desk 4",
        status: "CONFIRMED",
        createdAt: "2026-10-25T10:00:00Z",
        projectBillingCode: "PROJ-Alpha",
        venue: {
          name: "WeWork Downtown",
          category: "Coworking",
          address: "123 Main St",
        },
      },
      {
        id: "b2",
        date: "2026-10-27",
        time: "14:00",
        duration: "120",
        status: "PENDING",
      },
    ];

    it("generates RFC-4180 compliant CSV with CRLF line endings", () => {
      const csv = generateBookingsCSV(mockBookings);
      const lines = csv.split("\r\n");

      expect(lines[0]).toBe(
        "Confirmation ID,Venue Name,Category,Address,Date,Time,Seat Number,Duration (mins),Status,Estimated Price ($),Tax ($),Total ($),Billing Code,Booked At",
      );
      expect(lines).toHaveLength(3);

      expect(lines[1]).toContain("CONF-001,WeWork Downtown,Coworking,123 Main St,2026-10-26,10:00,Desk 4,90,Confirmed,22.50,1.80,24.30,PROJ-Alpha");
      expect(lines[2]).toContain("WS-#b2,Workspace,Coworking,,2026-10-27,14:00,General,120,Pending,30.00,2.40,32.40,N/A");
    });

    it("safely handles null options parameter", () => {
      const csv = generateBookingsCSV(mockBookings, null as any);
      expect(csv).toContain("Confirmation ID,Venue Name");
      expect(csv).toContain("CONF-001");
    });

    it("handles nullish bookings array gracefully", () => {
      expect(generateBookingsCSV(null as any)).toBe(
        "Confirmation ID,Venue Name,Category,Address,Date,Time,Seat Number,Duration (mins),Status,Estimated Price ($),Tax ($),Total ($),Billing Code,Booked At",
      );
    });
  });

  describe("downloadBookingsCSV", () => {
    it("creates CSV blob and triggers browser download", () => {
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const appendSpy = jest.spyOn(document.body, "appendChild");
      const removeSpy = jest.spyOn(document.body, "removeChild");

      const blob = downloadBookingsCSV([], { venueName: "Test Venue", filename: "my-bookings.csv" });

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("text/csv;charset=utf-8;");
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(appendSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();

      clickSpy.mockRestore();
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it("safely handles null options", () => {
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const appendSpy = jest.spyOn(document.body, "appendChild");
      const removeSpy = jest.spyOn(document.body, "removeChild");

      const blob = downloadBookingsCSV([], null as any);
      expect(blob).toBeInstanceOf(Blob);

      clickSpy.mockRestore();
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe("generateBookingsExcel & downloadBookingsExcel", () => {
    it("safely handles null options in Excel generation", () => {
      const xml = generateBookingsExcel([], null as any);
      expect(xml).toContain("Workbook");
      expect(xml).toContain("Worksheet");
    });

    it("safely triggers downloadBookingsExcel with null options", () => {
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const appendSpy = jest.spyOn(document.body, "appendChild");
      const removeSpy = jest.spyOn(document.body, "removeChild");

      const blob = downloadBookingsExcel([], null as any);
      expect(blob).toBeInstanceOf(Blob);
      expect(global.URL.createObjectURL).toHaveBeenCalled();

      clickSpy.mockRestore();
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });
});
