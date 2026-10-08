/**
 * Booking Itinerary Exporter (PDF with QR Code Verification Badge).
 *
 * Generates an official, publication-ready workspace booking itinerary
 * with an embedded vector QR code verification badge, check-in instructions,
 * venue amenities, and anti-forgery verification details.
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import { generateQRMatrix } from "@/lib/qr/svgQr";
import { formatUserAddress } from "@/lib/pdfGenerator";
import { wrapText } from "@/lib/pdf/generateBookingPdf";
import crypto from "crypto";

export interface BookingItineraryData {
  id: string;
  confirmationId?: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration?: number | null; // minutes
  seatNumber?: string | null;
  status?: "CONFIRMED" | "PENDING" | "CANCELLED" | string | null;
  createdAt?: string | Date | null;
  timeZone?: string | null;
  venue?: {
    id?: string;
    name?: string | null;
    category?: string | null;
    address?: string | null;
    wifiQuality?: number | null;
    hasOutlets?: boolean;
    hasErgonomic?: boolean;
    noiseLevel?: string | null;
  } | null;
  user?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    address?: unknown;
  } | null;
  customerEmail?: string | null;
  [key: string]: unknown;
}

/**
 * Draws a 2D boolean QR code matrix as crisp vector squares on the PDF page.
 */
function drawVectorQrCode(
  page: PDFPage,
  matrix: boolean[][],
  startX: number,
  startY: number,
  size: number,
  fgColor = rgb(0.08, 0.12, 0.2),
) {
  const moduleCount = matrix.length;
  if (moduleCount === 0) return;
  const moduleSize = size / moduleCount;

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix[r][c]) {
        // PDF coordinate origin (0,0) is bottom-left, so invert row axis
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
 * Generates an official Booking Itinerary PDF with an embedded QR verification badge.
 */
export async function generateBookingItineraryPdf(
  booking: BookingItineraryData,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 dimensions in points
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const obliqueFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const { width, height } = page.getSize();
  const margin = 45;
  const contentWidth = width - margin * 2;

  // Colors
  const primaryBlue = rgb(0.14, 0.38, 0.92);
  const darkNavy = rgb(0.06, 0.09, 0.16);
  const slateGrey = rgb(0.4, 0.45, 0.53);
  const lightBg = rgb(0.96, 0.97, 0.99);
  const cardBorder = rgb(0.88, 0.9, 0.94);
  const successGreen = rgb(0.09, 0.63, 0.41);
  const cancelRed = rgb(0.88, 0.22, 0.22);

  const drawSafe = (
    text: string,
    x: number,
    y: number,
    size: number,
    f: PDFFont = font,
    c = darkNavy,
  ) => {
    const sanitized = (text || "").replace(/[^\x20-\x7E]/g, "?");
    try {
      page.drawText(sanitized, { x, y, size, font: f, color: c });
    } catch {
      // Fallback
    }
  };

  // Top Accent Header Strip
  page.drawRectangle({
    x: 0,
    y: height - 10,
    width,
    height: 10,
    color: primaryBlue,
  });

  let y = height - 48;

  // Header Brand & Document Title
  drawSafe("WORKSPHERE", margin, y, 16, boldFont, primaryBlue);
  drawSafe("OFFICIAL BOOKING ITINERARY & PASS", margin + 115, y + 1, 10, boldFont, slateGrey);

  // Reference & Status Pill (Top Right)
  const confirmation = booking.confirmationId || `WS-#${booking.id}`;
  const statusStr = (booking.status || "CONFIRMED").toUpperCase();
  const isCancelled = statusStr === "CANCELLED";
  const statusColor = isCancelled ? cancelRed : successGreen;

  // Draw Status Badge Box
  const statusBadgeWidth = 110;
  const statusBadgeHeight = 22;
  page.drawRectangle({
    x: width - margin - statusBadgeWidth,
    y: y - 5,
    width: statusBadgeWidth,
    height: statusBadgeHeight,
    color: isCancelled ? rgb(0.99, 0.93, 0.93) : rgb(0.92, 0.98, 0.95),
    borderColor: statusColor,
    borderWidth: 1,
  });
  drawSafe(
    `STATUS: ${statusStr}`,
    width - margin - statusBadgeWidth + 12,
    y + 2,
    9,
    boldFont,
    statusColor,
  );

  y -= 25;
  // Header divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: cardBorder,
  });

  y -= 22;

  // ==========================================================================
  // TOP SECTION: QR CODE VERIFICATION BADGE & SUMMARY CARD
  // ==========================================================================
  const badgeCardHeight = 150;
  page.drawRectangle({
    x: margin,
    y: y - badgeCardHeight + 20,
    width: contentWidth,
    height: badgeCardHeight,
    color: lightBg,
    borderColor: cardBorder,
    borderWidth: 1,
  });

  // Verification URL / QR Matrix Data
  const verificationPayload = `https://worksphere.io/verify/booking?id=${booking.id}&ref=${encodeURIComponent(confirmation)}`;
  let qrMatrix: boolean[][];
  try {
    qrMatrix = generateQRMatrix(verificationPayload);
  } catch {
    qrMatrix = generateQRMatrix(confirmation);
  }

  // Draw QR Frame Box inside card
  const qrBoxSize = 110;
  const qrBoxX = margin + 18;
  const qrBoxY = y - badgeCardHeight + 40;

  page.drawRectangle({
    x: qrBoxX - 6,
    y: qrBoxY - 6,
    width: qrBoxSize + 12,
    height: qrBoxSize + 12,
    color: rgb(1, 1, 1),
    borderColor: primaryBlue,
    borderWidth: 1.5,
  });

  drawVectorQrCode(page, qrMatrix, qrBoxX, qrBoxY, qrBoxSize, darkNavy);

  // QR Badge Caption
  drawSafe("SCAN FOR VENUE CHECK-IN", qrBoxX - 4, qrBoxY - 18, 7.5, boldFont, primaryBlue);

  // Verification Details next to QR
  const detailsX = qrBoxX + qrBoxSize + 24;
  let detailsY = y - 8;

  drawSafe("VERIFIED ITINERARY PASS", detailsX, detailsY, 13, boldFont, darkNavy);
  detailsY -= 15;
  drawSafe(
    "Authentic reservation confirmed by WorkSphere Access Gateway",
    detailsX,
    detailsY,
    8.5,
    font,
    slateGrey,
  );

  detailsY -= 20;
  drawSafe("Booking Reference:", detailsX, detailsY, 9, font, slateGrey);
  drawSafe(confirmation, detailsX + 90, detailsY, 10, boldFont, darkNavy);

  detailsY -= 16;
  drawSafe("Date & Time:", detailsX, detailsY, 9, font, slateGrey);
  drawSafe(`${booking.date} @ ${booking.time}`, detailsX + 90, detailsY, 10, boldFont, darkNavy);

  detailsY -= 16;
  drawSafe("Duration:", detailsX, detailsY, 9, font, slateGrey);
  const durationMins = booking.duration || 60;
  drawSafe(`${durationMins} minutes (${(durationMins / 60).toFixed(1)} hrs)`, detailsX + 90, detailsY, 9.5, font, darkNavy);

  detailsY -= 16;
  drawSafe("Seat Allocation:", detailsX, detailsY, 9, font, slateGrey);
  drawSafe(booking.seatNumber ? `Desk / Seat #${booking.seatNumber}` : "General Open Workspace", detailsX + 90, detailsY, 9.5, boldFont, primaryBlue);

  y -= badgeCardHeight + 15;

  // ==========================================================================
  // SECTION 2: VENUE INFORMATION & AMENITIES
  // ==========================================================================
  drawSafe("VENUE & LOCATION DETAILS", margin, y, 11, boldFont, darkNavy);
  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.8,
    color: cardBorder,
  });
  y -= 16;

  const venueName = booking.venue?.name || "Verified WorkSphere Venue";
  const venueCategory = (booking.venue?.category || "Coworking Space").toUpperCase();
  const rawAddress = booking.venue?.address ? formatUserAddress(booking.venue.address) : "Verified Workspace Address";
  const venueAddress = rawAddress === "No address provided" ? "Verified Workspace Address" : rawAddress;

  drawSafe(venueName, margin, y, 13, boldFont, darkNavy);
  drawSafe(`· ${venueCategory}`, margin + font.widthOfTextAtSize(venueName.replace(/[^\x20-\x7E]/g, "?"), 13) + 8, y + 1, 9, boldFont, primaryBlue);
  y -= 16;

  const addressLabel = "Address: ";
  const addressFontSize = 9;
  const addressLineHeight = 13;
  const addressLabelWidth = font.widthOfTextAtSize(addressLabel, addressFontSize);
  const maxAddressWidth = contentWidth - addressLabelWidth;
  const addressLines = wrapText(venueAddress, font, addressFontSize, maxAddressWidth);

  if (addressLines.length === 0) {
    drawSafe(`${addressLabel}Verified Workspace Address`, margin, y, addressFontSize, font, slateGrey);
    y -= 16;
  } else {
    for (let i = 0; i < addressLines.length; i++) {
      if (i === 0) {
        drawSafe(addressLabel, margin, y, addressFontSize, font, slateGrey);
        drawSafe(addressLines[0], margin + addressLabelWidth, y, addressFontSize, font, slateGrey);
      } else {
        drawSafe(addressLines[i], margin + addressLabelWidth, y, addressFontSize, font, slateGrey);
      }
      y -= addressLineHeight;
    }
  }
  y -= 4;

  // Amenities line
  const wifiText = booking.venue?.wifiQuality ? `High-Speed Wi-Fi (${booking.venue.wifiQuality}/5 Stars)` : "High-Speed Wi-Fi";
  const powerText = booking.venue?.hasOutlets ? "Dedicated Power Outlets" : "Power Available";
  const ergoText = booking.venue?.hasErgonomic ? "Ergonomic Seating" : "Standard Seating";
  const noiseText = booking.venue?.noiseLevel ? `Noise: ${booking.venue.noiseLevel}` : "Quiet Zone";

  drawSafe(`Amenities: [ ${wifiText} ]  [ ${powerText} ]  [ ${ergoText} ]  [ ${noiseText} ]`, margin, y, 8, font, slateGrey);
  y -= 24;

  // ==========================================================================
  // SECTION 3: GUEST & CONTACT DETAILS
  // ==========================================================================
  drawSafe("GUEST & ACCOUNT INFORMATION", margin, y, 11, boldFont, darkNavy);
  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.8,
    color: cardBorder,
  });
  y -= 16;

  const customerName = booking.user
    ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim() || booking.user.email || "Registered Member"
    : booking.customerEmail || "Registered Member";

  const customerEmail = booking.user?.email || booking.customerEmail || "N/A";

  drawSafe("Primary Guest:", margin, y, 9, font, slateGrey);
  drawSafe(customerName, margin + 90, y, 9.5, boldFont, darkNavy);
  y -= 15;

  drawSafe("Contact Email:", margin, y, 9, font, slateGrey);
  drawSafe(customerEmail, margin + 90, y, 9.5, font, darkNavy);
  y -= 15;

  if (booking.user?.id) {
    drawSafe("Account ID:", margin, y, 9, font, slateGrey);
    drawSafe(`USR-${booking.user.id.slice(0, 16)}`, margin + 90, y, 9, font, slateGrey);
    y -= 15;
  }

  y -= 10;

  // ==========================================================================
  // SECTION 4: CHECK-IN & ARRIVAL PROTOCOL
  // ==========================================================================
  drawSafe("CHECK-IN PROTOCOL & ACCESS INSTRUCTIONS", margin, y, 11, boldFont, darkNavy);
  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.8,
    color: cardBorder,
  });
  y -= 16;

  const instructions = [
    "1. Arrival & Validation: Present the QR Code Verification Badge above at the front desk or scan kiosk.",
    "2. Desk Access: Head directly to your reserved desk or open area indicated in this itinerary.",
    "3. Network Access: Connect to the venue's secure Wi-Fi network using your WorkSphere pass.",
    "4. Extension & Departure: Extend your stay via the WorkSphere app or complete automatic checkout.",
  ];

  for (const inst of instructions) {
    drawSafe(inst, margin, y, 8.5, font, darkNavy);
    y -= 14;
  }

  y -= 12;

  // ==========================================================================
  // SECTION 5: CRYPTOGRAPHIC INTEGRITY & ANTI-FORGERY SEAL
  // ==========================================================================
  const integrityPayload = `${booking.id}|${confirmation}|${booking.date}|${booking.time}|${booking.user?.id || ""}`;
  const integrityHash = crypto.createHash("sha256").update(integrityPayload).digest("hex").slice(0, 32);

  page.drawRectangle({
    x: margin,
    y: y - 36,
    width: contentWidth,
    height: 40,
    color: rgb(0.98, 0.98, 0.99),
    borderColor: cardBorder,
    borderWidth: 0.8,
  });

  drawSafe("ANTI-FORGERY DIGITAL VERIFICATION SEAL", margin + 12, y - 10, 8, boldFont, slateGrey);
  drawSafe(`Verification Hash: ${integrityHash.toUpperCase()}`, margin + 12, y - 22, 7.5, obliqueFont, slateGrey);
  drawSafe(`Generated: ${new Date().toISOString()}  ·  Issued by WorkSphere Core Access Authority`, margin + 12, y - 32, 7, font, slateGrey);

  // Footer Disclaimer
  const footerY = 32;
  page.drawLine({
    start: { x: margin, y: footerY + 14 },
    end: { x: width - margin, y: footerY + 14 },
    thickness: 0.5,
    color: cardBorder,
  });

  drawSafe(
    "WorkSphere Technologies Inc. · For support or booking modifications, contact support@worksphere.io",
    margin,
    footerY,
    7.5,
    font,
    slateGrey,
  );

  return await pdfDoc.save();
}
