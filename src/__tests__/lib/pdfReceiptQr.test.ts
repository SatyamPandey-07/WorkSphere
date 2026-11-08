import {
  generateBookingPdf,
  generateReceiptVerificationUrl,
  computeReceiptHash,
  drawVectorQrMatrix,
  BookingPdfData,
} from "@/lib/pdf/generateBookingPdf";
import { generateQRMatrix } from "@/lib/qr/svgQr";
import { PDFDocument } from "pdf-lib";

describe("PDF Receipt QR Code & Verification Tests", () => {
  const sampleBooking: BookingPdfData = {
    id: "booking-abc-123",
    confirmationId: "WS-CONF-9876",
    date: "2026-10-15",
    time: "09:30",
    duration: 120,
    seatNumber: "42A",
    status: "CONFIRMED",
    totalAmount: 35.5,
    currency: "$",
    createdAt: new Date("2026-10-08T10:00:00Z"),
    venue: {
      id: "venue-sf-1",
      name: "Downtown Innovation Hub",
      category: "Coworking Space",
      address: "100 Market St, San Francisco, CA",
    },
    user: {
      id: "user-rushabh",
      firstName: "Alex",
      lastName: "Rivera",
      email: "alex.rivera@example.com",
    },
  };

  describe("QR Verification URL & Cryptographic Tamper Hash", () => {
    it("generates a verification URL targeting https://worksphere.app/api/receipts/[bookingId]", () => {
      const url = generateReceiptVerificationUrl(sampleBooking);
      expect(url).toContain("https://worksphere.app/api/receipts/booking-abc-123");
      expect(url).toContain("hash=");
      expect(url).toContain("ref=WS-CONF-9876");
    });

    it("respects custom baseUrl option", () => {
      const url = generateReceiptVerificationUrl(sampleBooking, "https://staging.worksphere.app");
      expect(url).toContain("https://staging.worksphere.app/api/receipts/booking-abc-123");
    });

    it("computes a deterministic 32-character hex hash", () => {
      const hash1 = computeReceiptHash(sampleBooking);
      const hash2 = computeReceiptHash(sampleBooking);
      expect(hash1).toHaveLength(32);
      expect(hash1).toBe(hash2);
      expect(/^[0-9a-f]{32}$/.test(hash1)).toBe(true);
    });

    it("changes hash when booking data is altered (tamper detection)", () => {
      const originalHash = computeReceiptHash(sampleBooking);
      const tamperedBooking = {
        ...sampleBooking,
        totalAmount: 999.99, // tampered amount
      };
      const tamperedHash = computeReceiptHash(tamperedBooking);
      expect(tamperedHash).not.toBe(originalHash);

      const tamperedDate = {
        ...sampleBooking,
        date: "2026-12-31",
      };
      expect(computeReceiptHash(tamperedDate)).not.toBe(originalHash);
    });
  });

  describe("QR Code Matrix Stream Generation", () => {
    it("generates a valid QR code matrix for the verification URL", () => {
      const url = generateReceiptVerificationUrl(sampleBooking);
      const matrix = generateQRMatrix(url);
      expect(matrix).toBeDefined();
      expect(Array.isArray(matrix)).toBe(true);
      expect(matrix.length).toBeGreaterThanOrEqual(21); // Min Version 1 QR code size
      expect(matrix[0].length).toBe(matrix.length); // Square matrix
    });

    it("draws vector QR matrix onto PDF page without errors", async () => {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 842]);
      const matrix = generateQRMatrix("https://worksphere.app/api/receipts/test");

      expect(() => {
        drawVectorQrMatrix(page, matrix, 400, 700, 80);
      }).not.toThrow();

      const pdfBytes = await pdfDoc.save();
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);
    });
  });

  describe("generateBookingPdf document generation", () => {
    it("generates a valid, complete PDF document for confirmed bookings", async () => {
      const pdfBytes = await generateBookingPdf(sampleBooking);

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      // Verify PDF header magic bytes: %PDF-
      const headerString = String.fromCharCode(...pdfBytes.slice(0, 5));
      expect(headerString).toBe("%PDF-");

      // Verify document can be loaded back and parsed
      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBe(1);

      const page = loadedDoc.getPage(0);
      expect(page.getWidth()).toBeCloseTo(595, 0);
      expect(page.getHeight()).toBeCloseTo(842, 0);
    });

    it("handles minimal/partial booking metadata gracefully without throwing", async () => {
      const minimalBooking: BookingPdfData = {
        id: "minimal-123",
        date: "2026-11-01",
        time: "14:00",
      };

      const pdfBytes = await generateBookingPdf(minimalBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBe(1);
    });

    it("handles custom currency and non-ASCII character sanitization", async () => {
      const customBooking: BookingPdfData = {
        ...sampleBooking,
        currency: "EUR",
        totalAmount: 45.0,
        venue: {
          name: "Café de l'Étoile — Zürich 🌟",
          address: "123 Bahnhofstrasse, Zürich",
        },
      };

      const pdfBytes = await generateBookingPdf(customBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBe(1);
    });

    it("renders customizable company branding, tax invoice header, tax ID, and billing address (#5063)", async () => {
      const corporateBooking: BookingPdfData = {
        ...sampleBooking,
        companyName: "Acme Global Technologies Inc.",
        taxId: "US-EIN-987654321",
        billingAddress: "Suite 500, Enterprise Tower, 100 Corporate Way, New York, NY 10001",
        isTaxInvoice: true,
      };

      const pdfBytes = await generateBookingPdf(corporateBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBe(1);
      const page = loadedDoc.getPage(0);
      expect(page.getWidth()).toBeCloseTo(595, 0);
      expect(page.getHeight()).toBeCloseTo(842, 0);
    });

    it("supports company branding and tax invoice overrides via BookingPdfOptions (#5063)", async () => {
      const pdfBytes = await generateBookingPdf(sampleBooking, {
        companyName: "InnoCorp Solutions Ltd",
        taxId: "GB-VAT-123456789",
        billingAddress: "42 Innovation Road, London, EC1A 1BB, UK",
        isTaxInvoice: true,
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBe(1);
    });
  });
});
