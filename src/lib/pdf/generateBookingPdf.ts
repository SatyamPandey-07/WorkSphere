/**
 * Booking Confirmation & Receipt PDF Generator with Embedded Verification QR Code.
 *
 * Generates an official PDF receipt embedding a cryptographic tamper-checked QR code
 * in the upper-right header targeting https://worksphere.app/api/receipts/[bookingId].
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import { generateQRMatrix } from "@/lib/qr/svgQr";
import crypto from "crypto";

export interface BookingBillingInfo {
  companyName?: string | null;
  taxId?: string | null; // e.g. GSTIN, VAT, EIN
  billingAddress?: string | null;
  isTaxInvoice?: boolean;
}

export interface BookingPdfData {
  id: string;
  confirmationId?: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration?: number | null; // minutes
  seatNumber?: string | null;
  status?: string | null;
  totalAmount?: number | string | null;
  currency?: string | null;
  createdAt?: string | Date | null;
  companyName?: string | null;
  taxId?: string | null;
  billingAddress?: string | null;
  isTaxInvoice?: boolean;
  billing?: BookingBillingInfo | null;
  venue?: {
    id?: string;
    name?: string | null;
    category?: string | null;
    address?: string | null;
  } | null;
  user?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    address?: unknown;
    companyName?: string | null;
    taxId?: string | null;
    billingAddress?: string | null;
  } | null;
  customerEmail?: string | null;
  [key: string]: unknown;
}

export interface BookingPdfOptions {
  baseUrl?: string;
  verificationSecret?: string;
  companyName?: string | null;
  taxId?: string | null;
  billingAddress?: string | null;
  isTaxInvoice?: boolean;
}

/**
 * Computes a deterministic SHA-256 HMAC receipt hash / anti-tamper signature
 * for booking verification.
 */
export function computeReceiptHash(
  booking: Pick<BookingPdfData, "id" | "confirmationId" | "date" | "time" | "totalAmount">,
  secret = process.env.RECEIPT_VERIFICATION_SECRET || "worksphere-receipt-tamper-key",
): string {
  const payload = `${booking.id}:${booking.confirmationId || ""}:${booking.date || ""}:${booking.time || ""}:${booking.totalAmount || ""}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}

/**
 * Generates the tamper-checked verification URL for the QR code matrix.
 */
export function generateReceiptVerificationUrl(
  booking: Pick<BookingPdfData, "id" | "confirmationId" | "date" | "time" | "totalAmount">,
  baseUrl = "https://worksphere.app",
  secret?: string,
): string {
  const hash = computeReceiptHash(booking, secret);
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}/api/receipts/${encodeURIComponent(booking.id)}?hash=${hash}&ref=${encodeURIComponent(booking.confirmationId || `WS-${booking.id}`)}`;
}

/**
 * Draws a 2D boolean QR code matrix as vector squares directly on the PDF page.
 */
export function drawVectorQrMatrix(
  page: PDFPage,
  matrix: boolean[][],
  startX: number,
  startY: number,
  size: number,
  fgColor = rgb(0.06, 0.09, 0.16),
  bgColor = rgb(1, 1, 1),
): void {
  const moduleCount = matrix.length;
  if (moduleCount === 0) return;
  const moduleSize = size / moduleCount;

  // Background rect
  if (bgColor) {
    page.drawRectangle({
      x: startX,
      y: startY,
      width: size,
      height: size,
      color: bgColor,
    });
  }

  // Draw QR modules (PDF origin is bottom-left)
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix[r][c]) {
        const x = startX + c * moduleSize;
        const y = startY + (moduleCount - 1 - r) * moduleSize;
        page.drawRectangle({
          x,
          y,
          width: moduleSize,
          height: moduleSize,
          color: fgColor,
        });
      }
    }
  }
}

/**
 * Wraps text into multiple lines so that each line's rendered width does not exceed maxWidth.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const lines: string[] = [];
  const paragraphs = String(text).split(/\r?\n/);

  const getWidth = (t: string) => {
    try {
      return font.widthOfTextAtSize(t.replace(/[^\x20-\x7E]/g, "?"), fontSize);
    } catch {
      return t.length * fontSize * 0.6;
    }
  };

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      continue;
    }

    let currentLine = "";

    for (const word of words) {
      if (!currentLine) {
        if (getWidth(word) <= maxWidth) {
          currentLine = word;
        } else {
          // Token itself exceeds maxWidth; split by characters
          let chunk = "";
          for (const char of word) {
            if (getWidth(chunk + char) <= maxWidth) {
              chunk += char;
            } else {
              if (chunk) lines.push(chunk);
              chunk = char;
            }
          }
          currentLine = chunk;
        }
      } else {
        const testLine = `${currentLine} ${word}`;
        if (getWidth(testLine) <= maxWidth) {
          currentLine = testLine;
        } else {
          lines.push(currentLine);
          if (getWidth(word) <= maxWidth) {
            currentLine = word;
          } else {
            let chunk = "";
            for (const char of word) {
              if (getWidth(chunk + char) <= maxWidth) {
                chunk += char;
              } else {
                if (chunk) lines.push(chunk);
                chunk = char;
              }
            }
            currentLine = chunk;
          }
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * Generates a complete booking confirmation receipt PDF with an embedded
 * verification QR code in the upper-right header.
 */
export async function generateBookingPdf(
  booking: BookingPdfData,
  options: BookingPdfOptions = {},
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 (595.28 x 841.89 points)

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const obliqueFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const { width, height } = page.getSize();
  const margin = 45;
  const contentWidth = width - margin * 2;

  // Theme Colors
  const primaryBlue = rgb(0.14, 0.38, 0.92);
  const darkNavy = rgb(0.06, 0.09, 0.16);
  const slateGrey = rgb(0.4, 0.45, 0.53);
  const lightGrey = rgb(0.95, 0.96, 0.98);
  const cardBorder = rgb(0.86, 0.89, 0.93);
  const successGreen = rgb(0.09, 0.63, 0.41);

  const drawSafeText = (
    text: string,
    x: number,
    y: number,
    size: number,
    f: PDFFont = font,
    color = darkNavy,
  ) => {
    const sanitized = (text || "").replace(/[^\x20-\x7E]/g, "?");
    try {
      page.drawText(sanitized, { x, y, size, font: f, color });
    } catch {
      // Ignore text draw errors
    }
  };

  // Resolve customizable company branding & tax invoice metadata (#5063)
  const companyName =
    options.companyName ||
    booking.companyName ||
    booking.billing?.companyName ||
    booking.user?.companyName ||
    null;

  const taxId =
    options.taxId ||
    booking.taxId ||
    booking.billing?.taxId ||
    booking.user?.taxId ||
    null;

  const rawBillingAddress =
    options.billingAddress ||
    booking.billingAddress ||
    booking.billing?.billingAddress ||
    booking.user?.billingAddress ||
    null;
  const billingAddress = typeof rawBillingAddress === "string" ? rawBillingAddress : null;

  const isTaxInvoice = Boolean(
    options.isTaxInvoice ||
    booking.isTaxInvoice ||
    booking.billing?.isTaxInvoice ||
    companyName ||
    taxId
  );

  // Top Accent Bar
  page.drawRectangle({
    x: 0,
    y: height - 8,
    width,
    height: 8,
    color: primaryBlue,
  });

  // Header Section
  let y = height - 42;

  // Company Brand / Title (Top Left)
  if (companyName) {
    drawSafeText(companyName.toUpperCase(), margin, y, 14, boldFont, primaryBlue);
    y -= 14;
    drawSafeText("TAX INVOICE & BOOKING RECEIPT", margin, y, 9.5, boldFont, slateGrey);
    y -= 13;
    drawSafeText(`Ref: ${booking.confirmationId || `WS-${booking.id}`}`, margin, y, 8.5, font, slateGrey);
    if (taxId) {
      y -= 12;
      drawSafeText(`Tax ID / VAT: ${taxId}`, margin, y, 8, font, slateGrey);
    }
  } else if (isTaxInvoice) {
    drawSafeText("WORKSPHERE", margin, y, 16, boldFont, primaryBlue);
    y -= 15;
    drawSafeText("TAX INVOICE & BOOKING RECEIPT", margin, y, 10, boldFont, slateGrey);
    y -= 14;
    drawSafeText(`Ref: ${booking.confirmationId || `WS-${booking.id}`}`, margin, y, 8.5, font, slateGrey);
    if (taxId) {
      y -= 12;
      drawSafeText(`Tax ID / VAT: ${taxId}`, margin, y, 8, font, slateGrey);
    }
  } else {
    drawSafeText("WORKSPHERE", margin, y, 16, boldFont, primaryBlue);
    y -= 15;
    drawSafeText("BOOKING CONFIRMATION & RECEIPT", margin, y, 10, boldFont, slateGrey);
    y -= 14;
    drawSafeText(`Ref: ${booking.confirmationId || `WS-${booking.id}`}`, margin, y, 8.5, font, slateGrey);
  }

  // =========================================================================
  // UPPER-RIGHT HEADER: QR CODE VERIFICATION LINK WITH CAPTION
  // =========================================================================
  const qrSize = 84;
  const qrPadding = 4;
  const qrTotalBox = qrSize + qrPadding * 2;
  const qrX = width - margin - qrTotalBox;
  const qrY = height - 120;

  // Verification URL targeting https://worksphere.app/api/receipts/[bookingId]
  const verificationUrl = generateReceiptVerificationUrl(
    booking,
    options.baseUrl || "https://worksphere.app",
    options.verificationSecret,
  );

  let qrMatrix: boolean[][];
  try {
    qrMatrix = generateQRMatrix(verificationUrl);
  } catch {
    qrMatrix = generateQRMatrix(`https://worksphere.app/api/receipts/${booking.id}`);
  }

  // Draw QR Frame Container
  page.drawRectangle({
    x: qrX - 1,
    y: qrY - 1,
    width: qrTotalBox + 2,
    height: qrTotalBox + 2,
    color: rgb(1, 1, 1),
    borderColor: cardBorder,
    borderWidth: 1,
  });

  // Render QR Matrix
  drawVectorQrMatrix(page, qrMatrix, qrX + qrPadding, qrY + qrPadding, qrSize, darkNavy);

  // QR Code Caption: "Scan to verify reservation"
  const captionText = "Scan to verify reservation";
  const captionFontSize = 7.5;
  const captionWidth = font.widthOfTextAtSize(captionText, captionFontSize);
  const captionX = qrX + (qrTotalBox - captionWidth) / 2;
  const captionY = qrY - 12;

  drawSafeText(captionText, captionX, captionY, captionFontSize, boldFont, primaryBlue);

  // =========================================================================
  // RESERVATION SUMMARY & DETAILS
  // =========================================================================
  y = height - 150;

  // Horizontal separator
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: cardBorder,
  });

  y -= 25;

  // Reservation Status Box
  const status = (booking.status || "CONFIRMED").toUpperCase();
  page.drawRectangle({
    x: margin,
    y: y - 80,
    width: contentWidth,
    height: 95,
    color: lightGrey,
    borderColor: cardBorder,
    borderWidth: 1,
  });

  drawSafeText("RESERVATION OVERVIEW", margin + 16, y, 10, boldFont, darkNavy);
  drawSafeText(`Status: ${status}`, width - margin - 120, y, 9.5, boldFont, successGreen);

  y -= 20;
  drawSafeText("Date:", margin + 16, y, 9, font, slateGrey);
  drawSafeText(booking.date || "N/A", margin + 90, y, 9.5, boldFont, darkNavy);

  drawSafeText("Time:", margin + 250, y, 9, font, slateGrey);
  drawSafeText(booking.time || "N/A", margin + 300, y, 9.5, boldFont, darkNavy);

  y -= 18;
  drawSafeText("Duration:", margin + 16, y, 9, font, slateGrey);
  const durationStr = booking.duration ? `${booking.duration} mins` : "Standard Session";
  drawSafeText(durationStr, margin + 90, y, 9.5, font, darkNavy);

  drawSafeText("Seat / Desk:", margin + 250, y, 9, font, slateGrey);
  drawSafeText(booking.seatNumber ? `#${booking.seatNumber}` : "General Area", margin + 330, y, 9.5, boldFont, primaryBlue);

  y -= 18;
  drawSafeText("Total Paid:", margin + 16, y, 9, font, slateGrey);
  const currencySymbol = booking.currency || "$";
  const amountStr = booking.totalAmount !== undefined && booking.totalAmount !== null
    ? `${currencySymbol}${Number(booking.totalAmount).toFixed(2)}`
    : `${currencySymbol}0.00`;
  drawSafeText(amountStr, margin + 90, y, 10, boldFont, darkNavy);

  y -= 45;

  // Venue Details Section
  drawSafeText("VENUE INFORMATION", margin, y, 10, boldFont, darkNavy);
  y -= 6;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.8,
    color: cardBorder,
  });

  y -= 18;
  const venueName = booking.venue?.name || "WorkSphere Verified Venue";
  const venueCategory = booking.venue?.category || "Coworking Space";
  const rawVenueAddress = booking.venue?.address || "Address provided upon arrival";
  const venueAddress = typeof rawVenueAddress === "string" ? rawVenueAddress : String(rawVenueAddress);

  drawSafeText(venueName, margin, y, 12, boldFont, darkNavy);
  drawSafeText(
    `(${venueCategory.toUpperCase()})`,
    margin + boldFont.widthOfTextAtSize(venueName.replace(/[^\x20-\x7E]/g, "?"), 12) + 8,
    y + 1,
    8.5,
    boldFont,
    primaryBlue,
  );

  y -= 16;
  const addressLabel = "Address: ";
  const addressFontSize = 9;
  const addressLineHeight = 13;
  const addressLabelWidth = font.widthOfTextAtSize(addressLabel, addressFontSize);
  const maxAddressWidth = contentWidth - addressLabelWidth;
  const addressLines = wrapText(venueAddress, font, addressFontSize, maxAddressWidth);

  if (addressLines.length === 0) {
    drawSafeText(`${addressLabel}Address provided upon arrival`, margin, y, addressFontSize, font, slateGrey);
    y -= 16;
  } else {
    for (let i = 0; i < addressLines.length; i++) {
      if (i === 0) {
        drawSafeText(addressLabel, margin, y, addressFontSize, font, slateGrey);
        drawSafeText(addressLines[0], margin + addressLabelWidth, y, addressFontSize, font, slateGrey);
      } else {
        drawSafeText(addressLines[i], margin + addressLabelWidth, y, addressFontSize, font, slateGrey);
      }
      y -= addressLineHeight;
    }
  }

  y -= 14;

  // Guest & Billing Details Section (#5063)
  const hasBillingDetails = Boolean(companyName || taxId || billingAddress);
  const sectionTitle = hasBillingDetails ? "BILL TO & GUEST DETAILS" : "GUEST DETAILS";
  drawSafeText(sectionTitle, margin, y, 10, boldFont, darkNavy);
  y -= 6;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.8,
    color: cardBorder,
  });

  y -= 18;
  const guestName = booking.user
    ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim() || booking.user.email || "Registered Member"
    : booking.customerEmail || "Registered Member";

  const guestEmail = booking.user?.email || booking.customerEmail || "N/A";

  drawSafeText("Guest Name:", margin, y, 9, font, slateGrey);
  drawSafeText(guestName, margin + 90, y, 9.5, boldFont, darkNavy);

  y -= 16;
  drawSafeText("Email:", margin, y, 9, font, slateGrey);
  drawSafeText(guestEmail, margin + 90, y, 9, font, darkNavy);

  if (companyName) {
    y -= 16;
    drawSafeText("Company:", margin, y, 9, font, slateGrey);
    drawSafeText(companyName, margin + 90, y, 9.5, boldFont, darkNavy);
  }

  if (taxId) {
    y -= 16;
    drawSafeText("Tax ID / GST:", margin, y, 9, font, slateGrey);
    drawSafeText(taxId, margin + 90, y, 9.5, boldFont, darkNavy);
  }

  if (billingAddress) {
    y -= 16;
    const bLabel = "Billing Address: ";
    const bFontSize = 9;
    const bLineHeight = 13;
    const bLabelWidth = font.widthOfTextAtSize(bLabel, bFontSize);
    const maxBWidth = contentWidth - bLabelWidth;
    const bLines = wrapText(billingAddress, font, bFontSize, maxBWidth);

    if (bLines.length === 0) {
      drawSafeText(`${bLabel}${billingAddress}`, margin, y, bFontSize, font, slateGrey);
      y -= 16;
    } else {
      for (let i = 0; i < bLines.length; i++) {
        if (i === 0) {
          drawSafeText(bLabel, margin, y, bFontSize, font, slateGrey);
          drawSafeText(bLines[0], margin + bLabelWidth, y, bFontSize, font, darkNavy);
        } else {
          drawSafeText(bLines[i], margin + bLabelWidth, y, bFontSize, font, darkNavy);
        }
        y -= bLineHeight;
      }
    }
  }

  y -= 25;

  // Tamper-Check & Cryptographic Verification Footer Block
  const receiptHash = computeReceiptHash(booking, options.verificationSecret);

  page.drawRectangle({
    x: margin,
    y: y - 45,
    width: contentWidth,
    height: 52,
    color: rgb(0.98, 0.99, 1),
    borderColor: cardBorder,
    borderWidth: 0.8,
  });

  drawSafeText("CRYPTOGRAPHIC TAMPER-PROOF VERIFICATION", margin + 12, y - 10, 8, boldFont, slateGrey);
  drawSafeText(`Verification Hash: ${receiptHash.toUpperCase()}`, margin + 12, y - 22, 7.5, obliqueFont, slateGrey);
  drawSafeText(`Verify Online: https://worksphere.app/api/receipts/${booking.id}`, margin + 12, y - 34, 7.5, font, primaryBlue);

  // Footer text
  const footerY = 32;
  page.drawLine({
    start: { x: margin, y: footerY + 12 },
    end: { x: width - margin, y: footerY + 12 },
    thickness: 0.5,
    color: cardBorder,
  });

  drawSafeText(
    "WorkSphere Inc. · Generated automatically. Present QR code upon arrival at venue.",
    margin,
    footerY,
    7.5,
    font,
    slateGrey,
  );

  return await pdfDoc.save();
}
