import {
  generateNomadAttendanceCertificate,
  validateAttendanceData,
  computeAttendanceCertificateHash,
  generateCertificateId,
  generateCertificateVerificationUrl,
  formatAttendanceDuration,
  AttendanceStayDetails,
} from "@/lib/pdf/generateCertificate";
import { PDFDocument } from "pdf-lib";

describe("Nomad Attendance Certificate PDF Generator", () => {
  const sampleCompletedBooking: AttendanceStayDetails = {
    bookingId: "cl_sample_booking_123",
    confirmationId: "WS-CONF-7788",
    certificateId: "WS-CERT-7788",
    nomadName: "Alex Rivera",
    nomadEmail: "alex.rivera@example.com",
    venueName: "The Work Collective Lisbon",
    venueAddress: "Rua do Alecrim 45, 1200-014 Lisboa, Portugal",
    venueCategory: "Coworking Space",
    checkInTime: "2026-11-20T09:00:00.000Z",
    checkOutTime: "2026-11-20T17:30:00.000Z",
    timeZone: "Europe/Lisbon",
    status: "COMPLETED",
    seatNumber: "Desk-42",
  };

  describe("Validation & Duration Formatting", () => {
    it("validates and parses complete valid attendance data correctly", () => {
      const validated = validateAttendanceData(sampleCompletedBooking);
      expect(validated.bookingId).toBe("cl_sample_booking_123");
      expect(validated.confirmationId).toBe("WS-CONF-7788");
      expect(validated.certificateId).toBe("WS-CERT-7788");
      expect(validated.nomadName).toBe("Alex Rivera");
      expect(validated.venueName).toBe("The Work Collective Lisbon");
      expect(validated.durationMinutes).toBe(510); // 8.5 hours = 510 minutes
      expect(validated.durationFormatted).toBe("8 hrs 30 mins");
      expect(validated.confirmationHash).toBeDefined();
      expect(validated.confirmationHash.length).toBe(64); // SHA-256 hex
    });

    it("formats various durations correctly", () => {
      expect(formatAttendanceDuration(45)).toBe("45 mins");
      expect(formatAttendanceDuration(60)).toBe("1 hr");
      expect(formatAttendanceDuration(120)).toBe("2 hrs");
      expect(formatAttendanceDuration(125)).toBe("2 hrs 5 mins");
    });

    it("rejects missing bookingId", () => {
      expect(() =>
        validateAttendanceData({ ...sampleCompletedBooking, bookingId: "" }),
      ).toThrow("Missing required field: bookingId");
    });

    it("rejects missing nomadName", () => {
      expect(() =>
        validateAttendanceData({ ...sampleCompletedBooking, nomadName: "" }),
      ).toThrow("Missing required field: nomadName");
    });

    it("rejects missing venueName or venueAddress", () => {
      expect(() =>
        validateAttendanceData({ ...sampleCompletedBooking, venueName: "" }),
      ).toThrow("Missing required field: venueName");

      expect(() =>
        validateAttendanceData({ ...sampleCompletedBooking, venueAddress: "" }),
      ).toThrow("Missing required field: venueAddress");
    });

    it("rejects invalid or missing timestamps", () => {
      expect(() =>
        validateAttendanceData({ ...sampleCompletedBooking, checkInTime: "invalid-date" }),
      ).toThrow(/Invalid timestamp for checkInTime/);

      expect(() =>
        validateAttendanceData({ ...sampleCompletedBooking, checkOutTime: "" }),
      ).toThrow(/Missing required timestamp for checkOutTime/);
    });

    it("rejects checkOut earlier than checkIn", () => {
      expect(() =>
        validateAttendanceData({
          ...sampleCompletedBooking,
          checkInTime: "2026-11-20T17:00:00.000Z",
          checkOutTime: "2026-11-20T09:00:00.000Z",
        }),
      ).toThrow(/Check-out time .* cannot be earlier than check-in time/);
    });

    it("rejects cancelled bookings", () => {
      expect(() =>
        validateAttendanceData({
          ...sampleCompletedBooking,
          status: "CANCELLED",
        }),
      ).toThrow(/Cannot generate certificate for status: CANCELLED/);

      expect(() =>
        validateAttendanceData({
          ...sampleCompletedBooking,
          status: "CANCELLED_BY_OPERATOR",
        }),
      ).toThrow(/Cannot generate certificate for status: CANCELLED_BY_OPERATOR/);

      expect(() =>
        validateAttendanceData({
          ...sampleCompletedBooking,
          status: "PENDING",
        }),
      ).toThrow(/Cannot generate certificate for status: PENDING/);
    });
  });

  describe("Deterministic IDs, Hashes, and QR URLs", () => {
    it("generates deterministic certificate ID from confirmationId or bookingId", () => {
      const id1 = generateCertificateId("b123", "WS-CONF-9999");
      expect(id1).toBe("WS-CERT-WSCONF9999");

      const id2 = generateCertificateId("b123", null);
      expect(id2).toBe("WS-CERT-B123");
    });

    it("generates deterministic HMAC-SHA256 digest that changes when stay facts change", () => {
      const hash1 = computeAttendanceCertificateHash({
        certificateId: "WS-CERT-1",
        bookingId: "b1",
        nomadName: "John Doe",
        venueName: "Hub 1",
        checkInTime: "2026-11-20T09:00:00.000Z",
        checkOutTime: "2026-11-20T17:00:00.000Z",
      });

      const hash2 = computeAttendanceCertificateHash({
        certificateId: "WS-CERT-1",
        bookingId: "b1",
        nomadName: "John Doe",
        venueName: "Hub 1",
        checkInTime: "2026-11-20T09:00:00.000Z",
        checkOutTime: "2026-11-20T17:00:00.000Z",
      });

      // Same facts produce identical hash
      expect(hash1).toBe(hash2);

      // Altering check-out changes the hash (tamper detection)
      const alteredHash = computeAttendanceCertificateHash({
        certificateId: "WS-CERT-1",
        bookingId: "b1",
        nomadName: "John Doe",
        venueName: "Hub 1",
        checkInTime: "2026-11-20T09:00:00.000Z",
        checkOutTime: "2026-11-20T18:00:00.000Z",
      });
      expect(alteredHash).not.toBe(hash1);
    });

    it("builds the canonical verification URL without hardcoded localhost", () => {
      const url = generateCertificateVerificationUrl("WS-CERT-123", "abc1234567890abcdef1234567890abc", "https://worksphere.app");
      expect(url).toContain("https://worksphere.app/api/certificates/verify");
      expect(url).toContain("id=WS-CERT-123");
      expect(url).toContain("hash=abc1234567890abcdef1234567890ab");
    });
  });

  describe("PDF Document Generation & PDF Parser Validation", () => {
    it("generates a valid PDF with correct magic header (%PDF-)", async () => {
      const pdfBytes = await generateNomadAttendanceCertificate(sampleCompletedBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      // Verify PDF magic bytes '%PDF-'
      const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf-8");
      expect(header).toBe("%PDF-");
    });

    it("can be loaded and inspected by pdf-lib parser", async () => {
      const pdfBytes = await generateNomadAttendanceCertificate(sampleCompletedBooking);
      const doc = await PDFDocument.load(pdfBytes);

      expect(doc.getPageCount()).toBe(1);
      const page = doc.getPage(0);
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(841.89, 1);
    });

    it("handles international names and special characters safely", async () => {
      const internationalBooking: AttendanceStayDetails = {
        ...sampleCompletedBooking,
        nomadName: "Björn François-Åkesson & José Peña-Nuñez",
        venueName: "Café Mühle & Coworking Zürich",
        venueAddress: "Bahnhofstraße 12, 8001 Zürich, Switzerland",
      };

      const pdfBytes = await generateNomadAttendanceCertificate(internationalBooking);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBe(1);
    });

    it("supports custom baseUrl and pre-computed cryptographic signature", async () => {
      const pdfBytes = await generateNomadAttendanceCertificate(
        {
          ...sampleCompletedBooking,
          signature: "CUSTOM-RSA-OR-ECDSA-SIGNATURE-HEX-123456",
        },
        {
          baseUrl: "https://staging.worksphere.io",
        },
      );

      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBe(1);
    });
  });
});
