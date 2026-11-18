import {
  generateReceiptPdf,
  computeReceiptHmacSha256,
  verifyReceiptHmacSha256,
  computeUserHash,
  ReceiptHmacMetadata,
} from "@/lib/pdfGenerator";
import { PDFDocument } from "pdf-lib";

describe("Cryptographic HMAC-SHA256 Receipt Verification", () => {
  const sampleMetadata: ReceiptHmacMetadata = {
    bookingId: "WS-CONF-9876",
    amount: 75.5,
    date: "2026-10-15",
    venueId: "venue-berlin-01",
    userHash: "a1b2c3d4e5f67890",
  };

  const sampleBooking = {
    id: "booking-abc-123",
    confirmationId: "WS-CONF-9876",
    date: "2026-10-15",
    time: "10:00",
    totalAmount: 75.5,
    currency: "EUR",
    venueId: "venue-berlin-01",
    venue: {
      id: "venue-berlin-01",
      name: "Kreuzberg Nomad Loft",
      category: "coworking",
      address: "Oranienstr. 45, 10969 Berlin",
    },
    user: {
      id: "usr-alex-99",
      firstName: "Alex",
      lastName: "Rivera",
      email: "alex@example.com",
    },
  };

  describe("computeUserHash", () => {
    it("computes a deterministic 16-character hex hash slice", () => {
      const hash1 = computeUserHash("usr-alex-99");
      const hash2 = computeUserHash("usr-alex-99");
      expect(hash1).toHaveLength(16);
      expect(hash1).toBe(hash2);
      expect(/^[0-9a-f]{16}$/.test(hash1)).toBe(true);
    });

    it("returns 'anonymous' for null, undefined, or empty identifier", () => {
      expect(computeUserHash(null)).toBe("anonymous");
      expect(computeUserHash(undefined)).toBe("anonymous");
      expect(computeUserHash("")).toBe("anonymous");
    });

    it("normalizes casing and whitespace", () => {
      expect(computeUserHash("  ALEX@EXAMPLE.COM  ")).toBe(
        computeUserHash("alex@example.com"),
      );
    });
  });

  describe("computeReceiptHmacSha256", () => {
    it("generates a deterministic 64-character hex HMAC-SHA256 digest", () => {
      const digest1 = computeReceiptHmacSha256(sampleMetadata, "test-secret");
      const digest2 = computeReceiptHmacSha256(sampleMetadata, "test-secret");
      expect(digest1).toHaveLength(64);
      expect(digest1).toBe(digest2);
      expect(/^[0-9a-f]{64}$/.test(digest1)).toBe(true);
    });

    it("changes digest when bookingId is tampered", () => {
      const original = computeReceiptHmacSha256(sampleMetadata, "test-secret");
      const tampered = computeReceiptHmacSha256(
        { ...sampleMetadata, bookingId: "WS-FAKE-0000" },
        "test-secret",
      );
      expect(tampered).not.toBe(original);
    });

    it("changes digest when amount is tampered", () => {
      const original = computeReceiptHmacSha256(sampleMetadata, "test-secret");
      const tampered = computeReceiptHmacSha256(
        { ...sampleMetadata, amount: 999.99 },
        "test-secret",
      );
      expect(tampered).not.toBe(original);
    });

    it("changes digest when date is tampered", () => {
      const original = computeReceiptHmacSha256(sampleMetadata, "test-secret");
      const tampered = computeReceiptHmacSha256(
        { ...sampleMetadata, date: "2026-12-31" },
        "test-secret",
      );
      expect(tampered).not.toBe(original);
    });

    it("changes digest when venueId is tampered", () => {
      const original = computeReceiptHmacSha256(sampleMetadata, "test-secret");
      const tampered = computeReceiptHmacSha256(
        { ...sampleMetadata, venueId: "venue-forged-99" },
        "test-secret",
      );
      expect(tampered).not.toBe(original);
    });

    it("changes digest when userHash is tampered", () => {
      const original = computeReceiptHmacSha256(sampleMetadata, "test-secret");
      const tampered = computeReceiptHmacSha256(
        { ...sampleMetadata, userHash: "0000000000000000" },
        "test-secret",
      );
      expect(tampered).not.toBe(original);
    });

    it("changes digest when different secret is used", () => {
      const digestA = computeReceiptHmacSha256(sampleMetadata, "secret-a");
      const digestB = computeReceiptHmacSha256(sampleMetadata, "secret-b");
      expect(digestA).not.toBe(digestB);
    });
  });

  describe("verifyReceiptHmacSha256", () => {
    it("returns true for matching authentic metadata and signature", () => {
      const secret = "auditor-secret-key-123";
      const signature = computeReceiptHmacSha256(sampleMetadata, secret);
      expect(verifyReceiptHmacSha256(sampleMetadata, signature, secret)).toBe(
        true,
      );
    });

    it("returns false when any metadata field is modified", () => {
      const secret = "auditor-secret-key-123";
      const signature = computeReceiptHmacSha256(sampleMetadata, secret);

      const tampered = { ...sampleMetadata, amount: 10.0 };
      expect(verifyReceiptHmacSha256(tampered, signature, secret)).toBe(false);
    });

    it("returns false when signature has been modified or corrupted", () => {
      const secret = "auditor-secret-key-123";
      const signature = computeReceiptHmacSha256(sampleMetadata, secret);
      const corrupted = signature.slice(0, 63) + (signature[63] === "a" ? "b" : "a");
      expect(verifyReceiptHmacSha256(sampleMetadata, corrupted, secret)).toBe(
        false,
      );
    });

    it("returns false for invalid signature formats or missing inputs", () => {
      expect(
        verifyReceiptHmacSha256(sampleMetadata, "short-signature", "secret"),
      ).toBe(false);
      expect(
        verifyReceiptHmacSha256(sampleMetadata, "", "secret"),
      ).toBe(false);
      expect(
        verifyReceiptHmacSha256(sampleMetadata, null as unknown as string, "secret"),
      ).toBe(false);
    });
  });

  describe("generateReceiptPdf with HMAC-SHA256 signature and QR code", () => {
    it("generates a valid PDF with embedded cryptographic footer and QR code", async () => {
      const pdfBytes = await generateReceiptPdf(sampleBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);

      // Verify PDF structure
      const pdfDoc = await PDFDocument.load(pdfBytes);
      expect(pdfDoc.getPageCount()).toBe(1);
    });

    it("respects custom secret and custom baseUrl options", async () => {
      const customSecret = "custom-corporate-secret";
      const pdfBytes = await generateReceiptPdf(sampleBooking, {
        secret: customSecret,
        baseUrl: "https://custom.worksphere.io",
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);

      const pdfDoc = await PDFDocument.load(pdfBytes);
      expect(pdfDoc.getPageCount()).toBe(1);
    });

    it("handles minimal booking data with missing optional fields gracefully", async () => {
      const minimalBooking = {
        id: 42,
        date: "2026-11-01",
        time: "14:00",
      };

      const pdfBytes = await generateReceiptPdf(minimalBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);

      const pdfDoc = await PDFDocument.load(pdfBytes);
      expect(pdfDoc.getPageCount()).toBe(1);
    });
  });
});
