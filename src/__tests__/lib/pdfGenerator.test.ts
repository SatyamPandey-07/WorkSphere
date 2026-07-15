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
  });
});
