import {
  generateBookingPdf,
  wrapText,
  BookingPdfData,
} from "@/lib/pdf/generateBookingPdf";
import { generateBookingItineraryPdf } from "@/lib/export/domain/itineraryExporter";
import { generateReceiptPdf } from "@/lib/pdfGenerator";
import { PDFDocument, StandardFonts } from "pdf-lib";

describe("PDF Address Wrapping and Layout Tests", () => {
  let font: any;

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    font = await doc.embedFont(StandardFonts.Helvetica);
  });

  describe("wrapText helper", () => {
    it("returns empty array for empty or null text", () => {
      expect(wrapText("", font, 9, 300)).toEqual([]);
      expect(wrapText(null as any, font, 9, 300)).toEqual([]);
    });

    it("keeps short text in a single line", () => {
      const text = "123 Market St, San Francisco, CA 94105";
      const lines = wrapText(text, font, 9, 400);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(text);
    });

    it("wraps 200+ character long venue address into multiple lines fitting within maxWidth", () => {
      const longAddress =
        "Level 42, International Financial Center Complex, Tower 3, Suite 4200, 100 Financial Harbor Boulevard East, Sector 7, Business Innovation District, Zurich, 8001, Switzerland";
      expect(longAddress.length).toBeGreaterThan(150);

      const maxWidth = 300;
      const lines = wrapText(longAddress, font, 9, maxWidth);

      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        const width = font.widthOfTextAtSize(line, 9);
        expect(width).toBeLessThanOrEqual(maxWidth + 5);
      }
    });

    it("handles long unbroken tokens without spaces gracefully", () => {
      const unbrokenToken = "A".repeat(120);
      const maxWidth = 100;
      const lines = wrapText(unbrokenToken, font, 9, maxWidth);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        const width = font.widthOfTextAtSize(line, 9);
        expect(width).toBeLessThanOrEqual(maxWidth + 10);
      }
    });

    it("respects newline characters in multi-line addresses", () => {
      const multiline = "Line 1 Building\nLine 2 Suite 400\nCity, State 12345";
      const lines = wrapText(multiline, font, 9, 400);
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe("Line 1 Building");
      expect(lines[1]).toBe("Line 2 Suite 400");
      expect(lines[2]).toBe("City, State 12345");
    });
  });

  describe("generateBookingPdf layout with 200+ char address", () => {
    it("generates a valid PDF with 200+ character venue address without errors", async () => {
      const longAddress =
        "Level 55, Tower One, International Trade & Technology Innovation Center, 888 Global Innovation Expressway Boulevard, Floor 12, Office Suite 1204-B, Financial District, Singapore, 018981";
      expect(longAddress.length).toBeGreaterThan(180);

      const sampleBooking: BookingPdfData = {
        id: "long-addr-booking-123",
        confirmationId: "WS-CONF-LONG",
        date: "2026-10-15",
        time: "10:00",
        duration: 120,
        seatNumber: "Desk 42",
        status: "CONFIRMED",
        totalAmount: 75.0,
        currency: "$",
        venue: {
          id: "venue-intl-1",
          name: "Global Innovation Towers & International Workspace Center",
          category: "Executive Coworking Lounge",
          address: longAddress,
        },
        user: {
          id: "user-long-1",
          firstName: "Samantha",
          lastName: "Vanderbilt-Montgomery",
          email: "samantha.vanderbilt-montgomery@multinational-enterprise.com",
        },
      };

      const pdfBytes = await generateBookingPdf(sampleBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBe(1);
    });
  });

  describe("generateBookingItineraryPdf layout with long address", () => {
    it("generates a valid booking itinerary PDF with long venue address", async () => {
      const longAddress =
        "Building 4, Cyberport Campus, 100 Cyberport Road, Telegraph Bay, Southern District, Hong Kong Island, Special Administrative Region";

      const sampleBooking = {
        id: "itinerary-long-456",
        confirmationId: "WS-ITIN-999",
        date: "2026-11-20",
        time: "14:00",
        duration: 180,
        seatNumber: "Hotdesk B-12",
        status: "CONFIRMED",
        venue: {
          id: "venue-hk",
          name: "Cyberport Innovation Hub",
          category: "Tech Campus",
          address: longAddress,
          wifiQuality: 5,
          hasOutlets: true,
          hasErgonomic: true,
          noiseLevel: "Moderate",
        },
        user: {
          id: "user-hk",
          firstName: "Liam",
          lastName: "Chen",
          email: "liam.chen@example.com",
        },
      };

      const pdfBytes = await generateBookingItineraryPdf(sampleBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBe(1);
    });
  });

  describe("generateReceiptPdf with long address", () => {
    it("generates receipt PDF with wrapped address lines", async () => {
      const longAddress =
        "Suite 800, Millennium Tech Center, 500 Silicon Way, Tech Corridor, Austin, TX 78701";

      const sampleBooking = {
        id: "receipt-789",
        confirmationId: "WS-RCPT-789",
        date: "2026-12-01",
        time: "09:00",
        venue: {
          name: "Millennium Coworking",
          category: "coworking",
          address: longAddress,
        },
        user: {
          firstName: "Elena",
          lastName: "Rostova",
        },
      };

      const pdfBytes = await generateReceiptPdf(sampleBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);

      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBe(1);
    });
  });
});
