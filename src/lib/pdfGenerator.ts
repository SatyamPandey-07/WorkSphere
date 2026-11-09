/**
 * PDF Generator re-export bridge and receipt/guest list generator.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { wrapText, drawVectorQrMatrix } from "./pdf/generateBookingPdf";
import { generateQRMatrix } from "./qr/svgQr";
import crypto from "crypto";

export { generateTaxExportPdf } from "./export/domain/taxExporter";
export {
  generateBookingItineraryPdf,
  type BookingItineraryData,
} from "./export/domain/itineraryExporter";
export {
  generateBookingPdf,
  wrapText,
  type BookingPdfData,
  type BookingPdfOptions,
} from "./pdf/generateBookingPdf";
export { PdfDocumentBuilder } from "./export/pdfBuilder";

/**
 * Formats address components cleanly without printing nullish or undefined values.
 * Drops null/undefined/empty components, joins valid parts, or defaults to "No address provided".
 */
export function formatUserAddress(address: any): string {
  if (address === null || address === undefined) {
    return "No address provided";
  }

  if (typeof address === "string") {
    const trimmed = address.trim();
    if (
      !trimmed ||
      trimmed.toLowerCase() === "null" ||
      trimmed.toLowerCase() === "undefined"
    ) {
      return "No address provided";
    }
    const parts = trimmed
      .split(/[,\n]+/)
      .map((p) => p.trim())
      .filter(
        (p) =>
          p && p.toLowerCase() !== "null" && p.toLowerCase() !== "undefined",
      );

    return parts.length > 0 ? parts.join(", ") : "No address provided";
  }

  if (Array.isArray(address)) {
    const parts = address
      .map((item) =>
        typeof item === "string" ? item.trim() : formatUserAddress(item),
      )
      .filter(
        (p) =>
          p &&
          p !== "No address provided" &&
          p.toLowerCase() !== "null" &&
          p.toLowerCase() !== "undefined",
      );

    return parts.length > 0 ? parts.join(", ") : "No address provided";
  }

  if (typeof address === "object") {
    const {
      street,
      streetAddress,
      addressLine1,
      line1,
      addressLine2,
      line2,
      suite,
      unit,
      apt,
      city,
      state,
      province,
      region,
      postalCode,
      zipCode,
      zip,
      postcode,
      country,
      ...rest
    } = address;

    const line1Part = [street, streetAddress, addressLine1, line1]
      .find(
        (v) =>
          typeof v === "string" &&
          v.trim() &&
          v.trim().toLowerCase() !== "null" &&
          v.trim().toLowerCase() !== "undefined",
      )
      ?.trim();

    const line2Part = [addressLine2, line2, suite, unit, apt]
      .find(
        (v) =>
          typeof v === "string" &&
          v.trim() &&
          v.trim().toLowerCase() !== "null" &&
          v.trim().toLowerCase() !== "undefined",
      )
      ?.trim();

    const cityPart =
      typeof city === "string" &&
      city.trim() &&
      city.trim().toLowerCase() !== "null" &&
      city.trim().toLowerCase() !== "undefined"
        ? city.trim()
        : undefined;

    const statePart = [state, province, region]
      .find(
        (v) =>
          typeof v === "string" &&
          v.trim() &&
          v.trim().toLowerCase() !== "null" &&
          v.trim().toLowerCase() !== "undefined",
      )
      ?.trim();

    const zipPart = [postalCode, zipCode, zip, postcode]
      .find(
        (v) =>
          typeof v === "string" &&
          v.trim() &&
          v.trim().toLowerCase() !== "null" &&
          v.trim().toLowerCase() !== "undefined",
      )
      ?.trim();

    const countryPart =
      typeof country === "string" &&
      country.trim() &&
      country.trim().toLowerCase() !== "null" &&
      country.trim().toLowerCase() !== "undefined"
        ? country.trim()
        : undefined;

    const otherParts = Object.values(rest)
      .filter(
        (v): v is string =>
          typeof v === "string" &&
          Boolean(v.trim()) &&
          v.trim().toLowerCase() !== "null" &&
          v.trim().toLowerCase() !== "undefined",
      )
      .map((v) => v.trim());

    const cityStateZip = [cityPart, statePart, zipPart]
      .filter(Boolean)
      .join(" ");

    const allOrderedParts = [
      line1Part,
      line2Part,
      cityStateZip || undefined,
      countryPart,
      ...otherParts,
    ].filter(Boolean);

    if (allOrderedParts.length === 0) {
      const genericValues = Object.values(address)
        .map((v) => {
          if (v === null || v === undefined) return null;
          if (typeof v === "string") {
            const t = v.trim();
            return t &&
              t.toLowerCase() !== "null" &&
              t.toLowerCase() !== "undefined"
              ? t
              : null;
          }
          if (typeof v === "number") return String(v);
          return null;
        })
        .filter((v): v is string => Boolean(v));

      return genericValues.length > 0
        ? genericValues.join(", ")
        : "No address provided";
    }

    return allOrderedParts.join(", ");
  }

  return "No address provided";
}

export const formatAddress = formatUserAddress;

export interface ReceiptHmacMetadata {
  bookingId: string | number;
  amount: string | number;
  date: string;
  venueId?: string | number | null;
  userHash?: string | null;
}

export interface ReceiptPdfOptions {
  secret?: string;
  baseUrl?: string;
}

/**
 * Computes a deterministic 16-character SHA-256 hash slice of a user identifier
 * to preserve privacy while maintaining tamper verification.
 */
export function computeUserHash(identifier?: string | number | null): string {
  if (!identifier) return "anonymous";
  return crypto
    .createHash("sha256")
    .update(String(identifier).trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

/**
 * Computes an HMAC-SHA256 verification digest of receipt metadata
 * (bookingId, amount, date, venueId, userHash) using a server secret.
 */
export function computeReceiptHmacSha256(
  metadata: ReceiptHmacMetadata,
  secret: string = process.env.RECEIPT_VERIFICATION_SECRET ||
    process.env.HMAC_SECRET ||
    "worksphere-receipt-tamper-secret-key-2026",
): string {
  const payload = [
    String(metadata.bookingId ?? ""),
    String(metadata.amount ?? ""),
    String(metadata.date ?? ""),
    String(metadata.venueId ?? ""),
    String(metadata.userHash ?? ""),
  ].join(":");

  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

/**
 * Verifies the authenticity and provenance of a receipt's HMAC-SHA256 digest.
 */
export function verifyReceiptHmacSha256(
  metadata: ReceiptHmacMetadata,
  signature: string,
  secret?: string,
): boolean {
  if (!signature || typeof signature !== "string") return false;
  const expected = computeReceiptHmacSha256(metadata, secret);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function generateReceiptPdf(
  booking: any,
  options?: ReceiptPdfOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const courierFont = await pdfDoc.embedFont(StandardFonts.Courier);

  const { width, height } = page.getSize();
  let yPosition = height - 50;

  const rawId = booking.id || booking.confirmationId || "UNKNOWN";
  const amount = booking.totalAmount ?? booking.amount ?? booking.price ?? 0;
  const date =
    booking.date ||
    (booking.createdAt
      ? typeof booking.createdAt === "string"
        ? booking.createdAt.split("T")[0]
        : new Date(booking.createdAt).toISOString().split("T")[0]
      : "");
  const venueId = booking.venueId || booking.venue?.id || "";
  const userIdentifier =
    booking.userId ||
    booking.user?.id ||
    booking.user?.email ||
    booking.customerEmail ||
    "";
  const userHash = computeUserHash(userIdentifier);

  const hmacSignature = computeReceiptHmacSha256(
    {
      bookingId: rawId,
      amount,
      date,
      venueId,
      userHash,
    },
    options?.secret,
  );

  const customerName = booking.user
    ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim()
    : booking.customerEmail || "N/A";

  const drawText = (text: string, opts: any) => {
    try {
      page.drawText(text, opts);
    } catch {
      const strictText = text.replace(/[^\x20-\x7E]/g, "?");
      try {
        page.drawText(strictText, opts);
      } catch {}
    }
  };

  page.drawRectangle({
    x: 0,
    y: height - 10,
    width,
    height: 10,
    color: rgb(0.23, 0.51, 0.96),
  });
  yPosition -= 60;

  drawText("WORKSPHERE CONFIRMATION", {
    x: 150,
    y: yPosition,
    size: 24,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  yPosition -= 15;
  drawText("SECURE TRANSACTION RECEIPT", {
    x: 180,
    y: yPosition,
    size: 8,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });
  yPosition -= 50;

  drawText("BOOKING DETAILS:", {
    x: 50,
    y: yPosition,
    size: 12,
    font: boldFont,
  });
  yPosition -= 15;
  drawText("-".repeat(50), { x: 50, y: yPosition, size: 10, font });
  yPosition -= 20;
  drawText(`REFERENCE ID: ${booking.confirmationId || `WS-#${booking.id}`}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 18;
  drawText(`VENUE: ${booking.venue?.name || "Workspace"}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 18;
  drawText(
    `CATEGORY: ${booking.venue?.category?.toUpperCase() || "WORKSPACE"}`,
    { x: 50, y: yPosition, size: 10, font },
  );
  yPosition -= 18;

  const venueAddress = booking.venue?.address
    ? formatAddress(booking.venue.address) === "No address provided"
      ? "Verified Workspace"
      : formatAddress(booking.venue.address)
    : "Verified Workspace";

  const addressLabel = "ADDRESS: ";
  const addressLines = wrapText(venueAddress, font, 10, 480);
  if (addressLines.length === 0) {
    drawText(`${addressLabel}Verified Workspace`, {
      x: 50,
      y: yPosition,
      size: 10,
      font,
    });
    yPosition -= 18;
  } else {
    for (let i = 0; i < addressLines.length; i++) {
      if (i === 0) {
        drawText(`${addressLabel}${addressLines[0]}`, {
          x: 50,
          y: yPosition,
          size: 10,
          font,
        });
      } else {
        drawText(`         ${addressLines[i]}`, {
          x: 50,
          y: yPosition,
          size: 10,
          font,
        });
      }
      yPosition -= 14;
    }
    yPosition -= 4;
  }
  drawText(`SCHEDULE: ${booking.date} @ ${booking.time}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 18;
  drawText(`CUSTOMER: ${customerName}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });

  const rawUserAddress =
    booking.user?.address ??
    booking.userAddress ??
    booking.customerAddress ??
    booking.billingAddress ??
    (booking.user &&
    (booking.user.street ||
      booking.user.streetAddress ||
      booking.user.addressLine1 ||
      booking.user.city ||
      booking.user.zipCode ||
      booking.user.postalCode)
      ? {
          street:
            booking.user.street ||
            booking.user.streetAddress ||
            booking.user.addressLine1,
          city: booking.user.city,
          state: booking.user.state,
          zip:
            booking.user.zipCode || booking.user.postalCode || booking.user.zip,
          country: booking.user.country,
        }
      : undefined);

  if (rawUserAddress !== undefined) {
    const formattedUserAddress = formatUserAddress(rawUserAddress);
    yPosition -= 18;
    drawText(`CUSTOMER ADDRESS: ${formattedUserAddress}`, {
      x: 50,
      y: yPosition,
      size: 10,
      font,
    });
  }

  if (amount !== undefined && amount !== null && amount !== 0) {
    const currency = booking.currency || "USD";
    const formattedAmount =
      typeof amount === "number" ? amount.toFixed(2) : String(amount);
    yPosition -= 18;
    drawText(`AMOUNT: ${currency} ${formattedAmount}`, {
      x: 50,
      y: yPosition,
      size: 10,
      font: boldFont,
    });
  }

  // --- Tamper-Evident Footer: Cryptographic HMAC-SHA256 & QR Code ---
  page.drawLine({
    start: { x: 50, y: 110 },
    end: { x: width - 50, y: 110 },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  });

  const baseUrl = options?.baseUrl || "https://worksphere.app";
  const verificationUrl = `${baseUrl.replace(/\/+$/, "")}/api/receipts/verify?id=${encodeURIComponent(String(rawId))}&sig=${hmacSignature}`;

  try {
    const qrMatrix = generateQRMatrix(verificationUrl);
    drawVectorQrMatrix(page, qrMatrix, 50, 42, 58);
  } catch {
    // If QR matrix generation encounters an edge case, proceed with text verification
  }

  const textX = 120;
  drawText("CRYPTOGRAPHIC AUTHENTICITY & PROVENANCE VERIFICATION", {
    x: textX,
    y: 92,
    size: 8,
    font: boldFont,
    color: rgb(0.1, 0.15, 0.25),
  });

  drawText("HMAC-SHA256 Verification Hash (Tamper-Evident Receipt Digest):", {
    x: textX,
    y: 80,
    size: 7,
    font,
    color: rgb(0.35, 0.4, 0.45),
  });

  drawText(hmacSignature, {
    x: textX,
    y: 69,
    size: 6.5,
    font: courierFont,
    color: rgb(0.05, 0.05, 0.05),
  });

  drawText(
    `Payload: [ID: ${rawId} | AMT: ${amount} | DATE: ${date} | VENUE: ${venueId || "N/A"} | USER: ${userHash}]`,
    {
      x: textX,
      y: 57,
      size: 6,
      font,
      color: rgb(0.45, 0.45, 0.5),
    },
  );

  drawText(
    "Auditors: Scan QR or verify HMAC-SHA256 digest against server key without external database query.",
    {
      x: textX,
      y: 47,
      size: 5.5,
      font,
      color: rgb(0.55, 0.55, 0.6),
    },
  );

  return await pdfDoc.save();
}

export async function generateGuestListPdf(
  booking: any,
  guests: any[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  let yPosition = height - 50;

  page.drawRectangle({
    x: 0,
    y: height - 10,
    width,
    height: 10,
    color: rgb(0.23, 0.51, 0.96),
  });
  yPosition -= 40;

  page.drawText("GUEST LIST", {
    x: 50,
    y: yPosition,
    size: 24,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  page.drawText(booking.venue?.name || "Verified Workspace", {
    x: 350,
    y: yPosition + 5,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  // Table Header
  page.drawText("Name", { x: 50, y: yPosition, size: 10, font: boldFont });
  page.drawText("Email", { x: 200, y: yPosition, size: 10, font: boldFont });
  page.drawText("Status", { x: 420, y: yPosition, size: 10, font: boldFont });

  yPosition -= 15;
  page.drawLine({
    start: { x: 50, y: yPosition + 5 },
    end: { x: 545, y: yPosition + 5 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });

  yPosition -= 15;
  for (const guest of guests.slice(0, 30)) {
    page.drawText(guest.name || "N/A", { x: 50, y: yPosition, size: 9, font });
    const email = guest.email || "N/A";
    const displayEmail =
      email.length > 25 ? email.substring(0, 22) + "..." : email;
    page.drawText(displayEmail, { x: 200, y: yPosition, size: 9, font });
    page.drawText(guest.status || "PENDING", {
      x: 420,
      y: yPosition,
      size: 9,
      font: boldFont,
    });
    yPosition -= 20;
    if (yPosition < 50) break;
  }

  return await pdfDoc.save();
}
