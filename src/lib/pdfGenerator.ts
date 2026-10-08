/**
 * PDF Generator re-export bridge and receipt/guest list generator.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export { generateTaxExportPdf } from "./export/domain/taxExporter";
export { generateBookingItineraryPdf, type BookingItineraryData } from "./export/domain/itineraryExporter";
export { generateBookingPdf, wrapText, type BookingPdfData, type BookingPdfOptions } from "./pdf/generateBookingPdf";
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
          p &&
          p.toLowerCase() !== "null" &&
          p.toLowerCase() !== "undefined",
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

    const line1Part = [street, streetAddress, addressLine1, line1].find(
      (v) =>
        typeof v === "string" &&
        v.trim() &&
        v.trim().toLowerCase() !== "null" &&
        v.trim().toLowerCase() !== "undefined",
    )?.trim();

    const line2Part = [addressLine2, line2, suite, unit, apt].find(
      (v) =>
        typeof v === "string" &&
        v.trim() &&
        v.trim().toLowerCase() !== "null" &&
        v.trim().toLowerCase() !== "undefined",
    )?.trim();

    const cityPart =
      typeof city === "string" &&
      city.trim() &&
      city.trim().toLowerCase() !== "null" &&
      city.trim().toLowerCase() !== "undefined"
        ? city.trim()
        : undefined;

    const statePart = [state, province, region].find(
      (v) =>
        typeof v === "string" &&
        v.trim() &&
        v.trim().toLowerCase() !== "null" &&
        v.trim().toLowerCase() !== "undefined",
    )?.trim();

    const zipPart = [postalCode, zipCode, zip, postcode].find(
      (v) =>
        typeof v === "string" &&
        v.trim() &&
        v.trim().toLowerCase() !== "null" &&
        v.trim().toLowerCase() !== "undefined",
    )?.trim();

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

export async function generateReceiptPdf(booking: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  let yPosition = height - 50;

  const customerName = booking.user
    ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim()
    : booking.customerEmail || "N/A";

  const drawText = (text: string, options: any) => {
    try {
      page.drawText(text, options);
    } catch {
      const strictText = text.replace(/[^\x20-\x7E]/g, "?");
      try {
        page.drawText(strictText, options);
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
            booking.user.zipCode ||
            booking.user.postalCode ||
            booking.user.zip,
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
    const displayEmail = email.length > 25 ? email.substring(0, 22) + "..." : email;
    page.drawText(displayEmail, { x: 200, y: yPosition, size: 9, font });
    page.drawText(guest.status || "PENDING", { x: 420, y: yPosition, size: 9, font: boldFont });
    yPosition -= 20;
    if (yPosition < 50) break;
  }

  return await pdfDoc.save();
}
