import {
  generateBookingItineraryPdf,
  BookingItineraryData,
} from "@/lib/export/domain/itineraryExporter";
import { PDFDocument } from "pdf-lib";

describe("generateBookingItineraryPdf hardening tests", () => {
  it("generates a valid PDF for standard booking data", async () => {
    const booking: BookingItineraryData = {
      id: "booking-std-100",
      confirmationId: "WS-CONF-100",
      date: "2026-11-15",
      time: "09:30",
      duration: 120,
      seatNumber: "A-14",
      status: "CONFIRMED",
      createdAt: "2026-10-26T10:00:00.000Z",
      venue: {
        id: "venue-alpha",
        name: "Central Hub Coworking",
        category: "Coworking Space",
        address: "100 Main Street, Suite 400, New York, NY",
        wifiQuality: 5,
        hasOutlets: true,
        hasErgonomic: true,
        noiseLevel: "Quiet",
      },
      user: {
        id: "user-alpha-123",
        firstName: "Alice",
        lastName: "Smith",
        email: "alice@example.com",
        companyName: "Acme Corp",
        taxId: "US-TAX-12345",
      },
    };

    const pdfBytes = await generateBookingItineraryPdf(booking);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("handles null and undefined booking safely without throwing", async () => {
    const pdfBytesNull = await generateBookingItineraryPdf(null as any);
    expect(pdfBytesNull).toBeInstanceOf(Uint8Array);
    expect(pdfBytesNull.length).toBeGreaterThan(500);

    const pdfBytesUndef = await generateBookingItineraryPdf(undefined as any);
    expect(pdfBytesUndef).toBeInstanceOf(Uint8Array);
    expect(pdfBytesUndef.length).toBeGreaterThan(500);
  });

  it("handles partial and empty booking object safely", async () => {
    const emptyBooking: BookingItineraryData = {} as any;
    const pdfBytes = await generateBookingItineraryPdf(emptyBooking);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(500);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("handles numeric user.id, seatNumber, and taxId without throwing", async () => {
    const booking = {
      id: "booking-num-200",
      date: "2026-11-20",
      time: "14:00",
      seatNumber: 42 as any,
      taxId: 987654321 as any,
      duration: 90,
      user: {
        id: 123456789 as any,
        firstName: "Bob",
        lastName: "Jones",
        email: "bob@example.com",
      },
    };

    const pdfBytes = await generateBookingItineraryPdf(booking as any);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("handles Date objects and invalid dates in date and createdAt safely", async () => {
    const booking = {
      id: "booking-date-300",
      confirmationId: "WS-DATE-300",
      date: new Date("2026-12-25T00:00:00.000Z") as any,
      time: "10:00",
      createdAt: new Date("2026-10-26T08:00:00.000Z"),
      venue: {
        name: "Holiday Desk Hub",
      },
    };

    const pdfBytes = await generateBookingItineraryPdf(booking as any);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);

    const invalidDateBooking = {
      id: "booking-invdate-301",
      date: new Date("invalid date") as any,
      time: "11:00",
      createdAt: new Date("invalid date"),
    };

    const invalidPdfBytes = await generateBookingItineraryPdf(invalidDateBooking as any);
    expect(invalidPdfBytes).toBeInstanceOf(Uint8Array);
    expect(invalidPdfBytes.length).toBeGreaterThan(1000);
  });

  it("handles cancelled status properly", async () => {
    const cancelledBooking: BookingItineraryData = {
      id: "booking-cancelled-400",
      confirmationId: "WS-CANCELLED-400",
      date: "2026-11-01",
      time: "08:00",
      status: "CANCELLED",
    };

    const pdfBytes = await generateBookingItineraryPdf(cancelledBooking);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  it("normalizes non-finite or negative durations to safe default", async () => {
    const nanDurationBooking: BookingItineraryData = {
      id: "booking-nan-500",
      date: "2026-11-02",
      time: "13:00",
      duration: NaN as any,
    };
    const negDurationBooking: BookingItineraryData = {
      id: "booking-neg-501",
      date: "2026-11-02",
      time: "13:00",
      duration: -60,
    };

    const pdf1 = await generateBookingItineraryPdf(nanDurationBooking);
    const pdf2 = await generateBookingItineraryPdf(negDurationBooking);
    expect(pdf1).toBeInstanceOf(Uint8Array);
    expect(pdf2).toBeInstanceOf(Uint8Array);
  });

  it("handles long venue names without throwing or corrupting layout", async () => {
    const longVenueBooking: BookingItineraryData = {
      id: "booking-long-venue-600",
      confirmationId: "WS-LONG-600",
      date: "2026-11-05",
      time: "15:00",
      venue: {
        name: "Super Massive Global Innovation Research Laboratory & Multi-Floor Corporate Workspace Hub",
        category: "Enterprise Innovation Campus",
      },
    };

    const pdfBytes = await generateBookingItineraryPdf(longVenueBooking);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });
});
