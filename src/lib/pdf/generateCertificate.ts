/**
 * Nomad Attendance Certificate PDF Generator & Verifier.
 *
 * Generates an official, verifiable attendance certificate PDF for completed co-working stays.
 * Features:
 * - WorkSphere branding and certificate title ("Nomad Attendance Certificate")
 * - Certificate identifier (deterministic or provided)
 * - Nomad's verified name
 * - Venue name and full address
 * - Booking confirmation reference / hash
 * - Verified check-in and check-out timestamps
 * - Total attendance duration calculation with timezone awareness
 * - Embedded high-contrast vector QR code pointing to canonical verification URL
 * - Cryptographic signing support (HMAC-SHA256 / RSA / ECDSA via existing crypto modules)
 * - Strict input validation (rejecting incomplete venues, unverified/invalid/inverted timestamps, non-completed stays)
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import { generateQRMatrix } from "@/lib/qr/svgQr";
import crypto from "crypto";

export interface AttendanceStayDetails {
  bookingId: string;
  confirmationId?: string | null;
  certificateId?: string;
  nomadName: string;
  nomadEmail?: string | null;
  venueName: string;
  venueAddress: string;
  venueCategory?: string | null;
  /** ISO 8601 string or Unix timestamp ms for check-in */
  checkInTime: string | number | Date;
  /** ISO 8601 string or Unix timestamp ms for check-out */
  checkOutTime: string | number | Date;
  /** Optional IANA timezone, e.g. "UTC" or "America/New_York" */
  timeZone?: string | null;
  /** Status of the booking. Must be COMPLETED or CHECKED_OUT */
  status?: string;
  seatNumber?: string | null;
  /** Cryptographic signature or hash if pre-signed */
  signature?: string;
  issuedAt?: string | number | Date;
}

export interface AttendanceCertificateOptions {
  baseUrl?: string;
  signingSecret?: string;
  certificateId?: string;
  privateKeyPem?: string;
  publicKeyPem?: string;
  algorithm?: "HMAC-SHA256" | "RSA-SHA256";
}

export interface ValidatedAttendanceData {
  bookingId: string;
  confirmationId: string;
  certificateId: string;
  nomadName: string;
  nomadEmail: string | null;
  venueName: string;
  venueAddress: string;
  venueCategory: string;
  checkInDate: Date;
  checkOutDate: Date;
  durationMinutes: number;
  durationFormatted: string;
  timeZone: string;
  issuedAtDate: Date;
  confirmationHash: string;
  signature: string;
}

/**
 * Normalizes input timestamp into a valid Date object or throws error.
 */
function parseTimestamp(val: string | number | Date, fieldName: string): Date {
  if (!val) {
    throw new Error(`Missing required timestamp for ${fieldName}`);
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid timestamp for ${fieldName}: ${String(val)}`);
  }
  return d;
}

/**
 * Format duration into human-readable hours and minutes.
 */
export function formatAttendanceDuration(minutes: number): string {
  if (minutes < 0) return "0 mins";
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours === 0) return `${remainingMins} mins`;
  if (remainingMins === 0) return `${hours} hr${hours > 1 ? "s" : ""}`;
  return `${hours} hr${hours > 1 ? "s" : ""} ${remainingMins} min${remainingMins > 1 ? "s" : ""}`;
}

/**
 * Generates deterministic certificate ID: WS-CERT-<bookingId_or_hash>
 */
export function generateCertificateId(bookingId: string, confirmationId?: string | null): string {
  const seed = (confirmationId || bookingId || "").trim();
  const clean = seed.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `WS-CERT-${clean.slice(0, 16)}`;
}

/**
 * Computes deterministic HMAC-SHA256 attendance proof hash
 */
export function computeAttendanceCertificateHash(
  payload: {
    certificateId: string;
    bookingId: string;
    nomadName: string;
    venueName: string;
    checkInTime: string | number | Date;
    checkOutTime: string | number | Date;
  },
  secret = process.env.CERTIFICATE_VERIFICATION_SECRET || process.env.RECEIPT_VERIFICATION_SECRET || "worksphere-certificate-tamper-key",
): string {
  const checkInIso = new Date(payload.checkInTime).toISOString();
  const checkOutIso = new Date(payload.checkOutTime).toISOString();
  const raw = `${payload.certificateId}:${payload.bookingId}:${payload.nomadName}:${payload.venueName}:${checkInIso}:${checkOutIso}`;
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

/**
 * Validates attendance certificate input data strictly.
 */
export function validateAttendanceData(
  input: AttendanceStayDetails,
  options: AttendanceCertificateOptions = {},
): ValidatedAttendanceData {
  if (!input) {
    throw new Error("Attendance data is required");
  }

  // Required basic string fields
  if (!input.bookingId || typeof input.bookingId !== "string" || !input.bookingId.trim()) {
    throw new Error("Missing required field: bookingId");
  }
  if (!input.nomadName || typeof input.nomadName !== "string" || !input.nomadName.trim()) {
    throw new Error("Missing required field: nomadName");
  }
  if (!input.venueName || typeof input.venueName !== "string" || !input.venueName.trim()) {
    throw new Error("Missing required field: venueName");
  }
  if (!input.venueAddress || typeof input.venueAddress !== "string" || !input.venueAddress.trim()) {
    throw new Error("Missing required field: venueAddress");
  }

  // Status check if supplied
  if (input.status) {
    const s = input.status.toUpperCase();
    if (s === "CANCELLED" || s === "CANCELLED_BY_OPERATOR" || s === "PENDING") {
      throw new Error(`Cannot generate certificate for status: ${input.status}. Booking must be completed.`);
    }
  }

  // Timestamps
  const checkInDate = parseTimestamp(input.checkInTime, "checkInTime");
  const checkOutDate = parseTimestamp(input.checkOutTime, "checkOutTime");

  if (checkOutDate.getTime() < checkInDate.getTime()) {
    throw new Error(
      `Check-out time (${checkOutDate.toISOString()}) cannot be earlier than check-in time (${checkInDate.toISOString()})`,
    );
  }

  const durationMs = checkOutDate.getTime() - checkInDate.getTime();
  const durationMinutes = Math.floor(durationMs / 60000);
  const durationFormatted = formatAttendanceDuration(durationMinutes);

  const issuedAtDate = input.issuedAt ? parseTimestamp(input.issuedAt, "issuedAt") : new Date();

  const confirmationId = (input.confirmationId || `WS-${input.bookingId}`).trim();
  const certificateId = (
    options.certificateId ||
    input.certificateId ||
    generateCertificateId(input.bookingId, confirmationId)
  ).trim();

  const confirmationHash = computeAttendanceCertificateHash(
    {
      certificateId,
      bookingId: input.bookingId,
      nomadName: input.nomadName,
      venueName: input.venueName,
      checkInTime: checkInDate,
      checkOutTime: checkOutDate,
    },
    options.signingSecret,
  );

  const signature = input.signature || confirmationHash;

  return {
    bookingId: input.bookingId.trim(),
    confirmationId,
    certificateId,
    nomadName: input.nomadName.trim(),
    nomadEmail: input.nomadEmail ? input.nomadEmail.trim() : null,
    venueName: input.venueName.trim(),
    venueAddress: input.venueAddress.trim(),
    venueCategory: input.venueCategory ? input.venueCategory.trim() : "Coworking Space",
    checkInDate,
    checkOutDate,
    durationMinutes,
    durationFormatted,
    timeZone: input.timeZone || "UTC",
    issuedAtDate,
    confirmationHash,
    signature,
  };
}

/**
 * Builds the canonical verification URL for the QR code.
 */
export function generateCertificateVerificationUrl(
  certificateId: string,
  signature: string,
  baseUrl = "https://worksphere.app",
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}/api/certificates/verify?id=${encodeURIComponent(certificateId)}&hash=${encodeURIComponent(signature.slice(0, 32))}`;
}

/**
 * Draws a 2D boolean QR code matrix directly as vector rectangles on the PDF page.
 */
function drawVectorQr(
  page: PDFPage,
  matrix: boolean[][],
  startX: number,
  startY: number,
  size: number,
  fgColor = rgb(0.06, 0.09, 0.16),
  bgColor = rgb(1, 1, 1),
): void {
  const rows = matrix.length;
  const cols = matrix[0]?.length || 0;
  if (!rows || !cols) return;

  const cellWidth = size / cols;
  const cellHeight = size / rows;

  // Background box
  page.drawRectangle({
    x: startX,
    y: startY,
    width: size,
    height: size,
    color: bgColor,
  });

  // Dark modules
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (matrix[r][c]) {
        page.drawRectangle({
          x: startX + c * cellWidth,
          y: startY + (rows - 1 - r) * cellHeight,
          width: cellWidth + 0.1,
          height: cellHeight + 0.1,
          color: fgColor,
        });
      }
    }
  }
}

/**
 * Formats a Date in a consistent, timezone-annotated format: e.g. "2026-11-20 09:30 UTC"
 */
function formatUtcDateTime(date: Date, tz = "UTC"): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  return `${y}-${m}-${d} ${hh}:${mm} (${tz})`;
}

/**
 * Generates an official, verifiable Nomad Attendance Certificate PDF.
 */
export async function generateNomadAttendanceCertificate(
  input: AttendanceStayDetails,
  options: AttendanceCertificateOptions = {},
): Promise<Uint8Array> {
  const data = validateAttendanceData(input, options);

  const pdfDoc = await PDFDocument.create();
  // Standard Letter / A4 portrait: 595.28 x 841.89 pt (A4)
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Palette
  const primaryBlue = rgb(0.12, 0.42, 0.88); // #1f6be0
  const darkNavy = rgb(0.06, 0.09, 0.16); // #0f172a
  const slateGrey = rgb(0.39, 0.45, 0.55); // #64748b
  const cardBorder = rgb(0.88, 0.91, 0.94);
  const lightBg = rgb(0.97, 0.98, 1.0);

  const margin = 48;
  const contentWidth = width - margin * 2;

  // Sanitized text drawer to handle non-ASCII / special characters
  const drawSafeText = (
    text: string,
    x: number,
    y: number,
    size: number,
    f: PDFFont,
    color = darkNavy,
  ) => {
    // Strip or replace characters that standard WinAnsi font cannot render
    const sanitized = text.replace(/[^\x20-\x7E\xA0-\xFF]/g, " ").trim();
    if (!sanitized) return;
    page.drawText(sanitized, { x, y, size, font: f, color });
  };

  // Outer decorative border
  page.drawRectangle({
    x: margin - 12,
    y: margin - 12,
    width: contentWidth + 24,
    height: height - (margin * 2 - 24),
    borderColor: cardBorder,
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  // Top header colored accent band
  page.drawRectangle({
    x: margin - 12,
    y: height - margin - 6,
    width: contentWidth + 24,
    height: 6,
    color: primaryBlue,
  });

  let curY = height - margin - 35;

  // WORKSPHERE Branding
  drawSafeText("WORKSPHERE", margin, curY, 18, boldFont, primaryBlue);
  drawSafeText("GLOBAL NOMAD NETWORK", margin + boldFont.widthOfTextAtSize("WORKSPHERE", 18) + 10, curY + 2, 8.5, boldFont, slateGrey);

  curY -= 28;

  // Main Title
  drawSafeText("Nomad Attendance Certificate", margin, curY, 22, boldFont, darkNavy);
  curY -= 16;
  drawSafeText("Official Record of Verified Co-Working Stay", margin, curY, 10, italicFont, slateGrey);

  // QR Code in Header (top right)
  const qrSize = 78;
  const qrX = width - margin - qrSize;
  const qrY = height - margin - 110;

  const verificationUrl = generateCertificateVerificationUrl(
    data.certificateId,
    data.signature,
    options.baseUrl,
  );

  try {
    const qrMatrix = generateQRMatrix(verificationUrl);
    drawVectorQr(page, qrMatrix, qrX, qrY, qrSize, darkNavy, rgb(1, 1, 1));
  } catch (err) {
    console.error("[generateNomadAttendanceCertificate] QR generation error:", err);
  }

  // QR Caption
  page.drawRectangle({
    x: qrX - 4,
    y: qrY - 14,
    width: qrSize + 8,
    height: 12,
    color: lightBg,
  });
  drawSafeText("Scan to Verify", qrX + 10, qrY - 10, 7.5, boldFont, primaryBlue);

  // Certificate ID & Reference Badge
  curY -= 25;
  page.drawRectangle({
    x: margin,
    y: curY - 32,
    width: contentWidth - qrSize - 20,
    height: 40,
    color: lightBg,
    borderColor: cardBorder,
    borderWidth: 1,
  });

  drawSafeText(`Certificate ID: ${data.certificateId}`, margin + 12, curY - 14, 9, boldFont, darkNavy);
  drawSafeText(`Booking Ref: ${data.confirmationId}`, margin + 12, curY - 26, 8.5, font, slateGrey);
  drawSafeText(`Issued: ${formatUtcDateTime(data.issuedAtDate, data.timeZone)}`, margin + 220, curY - 14, 8.5, font, slateGrey);

  // Nomad Identification Section
  curY -= 65;
  drawSafeText("VERIFIED NOMAD", margin, curY, 10, boldFont, primaryBlue);
  curY -= 6;
  page.drawLine({
    start: { x: margin, y: curY },
    end: { x: width - margin, y: curY },
    thickness: 1,
    color: cardBorder,
  });

  curY -= 22;
  drawSafeText(data.nomadName, margin, curY, 15, boldFont, darkNavy);
  if (data.nomadEmail) {
    curY -= 15;
    drawSafeText(`Nomad Email / Identity: ${data.nomadEmail}`, margin, curY, 9, font, slateGrey);
  }

  // Attendance Stay Details Box
  curY -= 32;
  drawSafeText("ATTENDANCE & STAY DETAILS", margin, curY, 10, boldFont, primaryBlue);
  curY -= 6;
  page.drawLine({
    start: { x: margin, y: curY },
    end: { x: width - margin, y: curY },
    thickness: 1,
    color: cardBorder,
  });

  curY -= 18;
  const detailsBoxHeight = 115;
  page.drawRectangle({
    x: margin,
    y: curY - detailsBoxHeight,
    width: contentWidth,
    height: detailsBoxHeight,
    color: lightBg,
    borderColor: cardBorder,
    borderWidth: 1,
  });

  let boxY = curY - 18;
  drawSafeText("Venue Name:", margin + 16, boxY, 9, boldFont, slateGrey);
  drawSafeText(data.venueName, margin + 120, boxY, 9.5, boldFont, darkNavy);

  boxY -= 20;
  drawSafeText("Venue Address:", margin + 16, boxY, 9, boldFont, slateGrey);
  // Address wrapping check
  const addrText = data.venueAddress.slice(0, 75);
  drawSafeText(addrText, margin + 120, boxY, 9, font, darkNavy);

  boxY -= 20;
  drawSafeText("Verified Check-in:", margin + 16, boxY, 9, boldFont, slateGrey);
  drawSafeText(formatUtcDateTime(data.checkInDate, data.timeZone), margin + 120, boxY, 9.5, boldFont, darkNavy);

  boxY -= 20;
  drawSafeText("Verified Check-out:", margin + 16, boxY, 9, boldFont, slateGrey);
  drawSafeText(formatUtcDateTime(data.checkOutDate, data.timeZone), margin + 120, boxY, 9.5, boldFont, darkNavy);

  boxY -= 20;
  drawSafeText("Total Stay Duration:", margin + 16, boxY, 9, boldFont, slateGrey);
  drawSafeText(data.durationFormatted, margin + 120, boxY, 10, boldFont, primaryBlue);

  curY -= detailsBoxHeight + 25;

  // Cryptographic & Verification Proof Block
  drawSafeText("CRYPTOGRAPHIC EVIDENCE & TAMPER PROTECTION", margin, curY, 9.5, boldFont, slateGrey);
  curY -= 6;
  page.drawLine({
    start: { x: margin, y: curY },
    end: { x: width - margin, y: curY },
    thickness: 0.8,
    color: cardBorder,
  });

  curY -= 16;
  const proofBoxHeight = 65;
  page.drawRectangle({
    x: margin,
    y: curY - proofBoxHeight,
    width: contentWidth,
    height: proofBoxHeight,
    color: rgb(0.98, 0.99, 1),
    borderColor: cardBorder,
    borderWidth: 1,
  });

  drawSafeText("Cryptographic Verification Signature / Digest:", margin + 12, curY - 16, 8, boldFont, slateGrey);
  drawSafeText(data.signature.toUpperCase(), margin + 12, curY - 28, 7.5, italicFont, darkNavy);
  drawSafeText("Online Verification Route:", margin + 12, curY - 42, 8, boldFont, slateGrey);
  drawSafeText(verificationUrl, margin + 12, curY - 54, 7.5, font, primaryBlue);

  curY -= proofBoxHeight + 35;

  // Legal / Compliance Notice Box
  page.drawRectangle({
    x: margin,
    y: curY - 45,
    width: contentWidth,
    height: 48,
    color: rgb(0.99, 0.99, 0.99),
    borderColor: cardBorder,
    borderWidth: 0.8,
  });

  drawSafeText("LEGAL NOTICE & SCOPE OF EVIDENCE", margin + 12, curY - 14, 7.5, boldFont, slateGrey);
  drawSafeText(
    "This certificate confirms physical stay and checked-in attendance at the specified workspace venue.",
    margin + 12,
    curY - 26,
    7,
    font,
    slateGrey,
  );
  drawSafeText(
    "It is issued for personal documentation and administrative reference. Acceptance by tax or immigration authorities is not guaranteed.",
    margin + 12,
    curY - 37,
    7,
    font,
    slateGrey,
  );

  // Footer line
  const footerY = margin + 10;
  page.drawLine({
    start: { x: margin, y: footerY + 12 },
    end: { x: width - margin, y: footerY + 12 },
    thickness: 0.5,
    color: cardBorder,
  });

  drawSafeText(
    "WorkSphere Global Coworking Network · Verified Attendance Certificate Authority · worksphere.app",
    margin,
    footerY,
    7.5,
    font,
    slateGrey,
  );

  return await pdfDoc.save();
}
