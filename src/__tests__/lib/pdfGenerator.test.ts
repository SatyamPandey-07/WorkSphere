import { generateReceiptPdf, generateTaxExportPdf } from "@/lib/pdfGenerator";
import fs from "fs";

jest.mock("fs", () => {
  const actualFs = jest.requireActual("fs");
  return {
    ...actualFs,
    promises: {
      ...actualFs.promises,
      readFile: jest.fn().mockImplementation((...args: any[]) => {
        return actualFs.promises.readFile(...args);
      }),
    },
  };
});

describe("PDF Generator", () => {
  const mockBooking = {
    id: 1,
    confirmationId: "WS-12345",
    date: "2026-07-15",
    time: "19:00",
    duration: 3,
    projectBillingCode: "BILL-456",
    customerEmail: "customer@example.com",
    user: { firstName: "Jane", lastName: "Smith" },
    venue: {
      name: "Library Hub",
      category: "library",
      address: "456 Library Ave",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("generateReceiptPdf", () => {
    it("should generate a valid PDF asynchronously using custom fonts from disk", async () => {
      const pdfBytes = await generateReceiptPdf(mockBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);
      expect(fs.promises.readFile).toHaveBeenCalledTimes(2);
    });

    it("should fall back gracefully to Helvetica if custom fonts fail to load", async () => {
      (fs.promises.readFile as jest.Mock).mockRejectedValue(
        new Error("Font load error"),
      );

      const pdfBytes = await generateReceiptPdf(mockBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);
      expect(fs.promises.readFile).toHaveBeenCalledTimes(2);
    });
  });

  describe("generateTaxExportPdf", () => {
    it("should generate a valid consolidated tax export PDF", async () => {
      const pdfBytes = await generateTaxExportPdf([mockBooking]);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);
    });

    it("should handle large bookings list and paginate across multiple pages successfully", async () => {
      const mockBookings = Array.from({ length: 50 }).map((_, i) => ({
        ...mockBooking,
        id: i + 1,
        confirmationId: `WS-CONF-${i + 1}`,
      }));
      const pdfBytes = await generateTaxExportPdf(mockBookings);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);

      // Load PDF and verify page count
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PDFDocument: LibPDFDocument } = require("pdf-lib");
      const doc = await LibPDFDocument.load(pdfBytes);
      // 2 summary pages (since 50 bookings exceed 42 vertical lines) + 50 details pages = 52 pages
      expect(doc.getPageCount()).toBe(52);
    });
  });
});
