import {
  PDFDocument,
  rgb,
  StandardFonts,
  PDFPageDrawTextOptions,
  breakTextIntoLines,
} from "pdf-lib";
import { safeText } from "./pdfHelpers";
import { sanitizeMathSymbols } from "./pdfUtils";

// Using the same drawSafeText as the export route, but we will duplicate the helper signature for local use here
export async function generateTaxExportPdf(
  bookings: any[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Summary page
  const summaryPage = pdfDoc.addPage([595, 842]);
  const { width, height } = summaryPage.getSize();
  let y = height - 50;

  summaryPage.drawRectangle({
    x: 0,
    y: height - 10,
    width,
    height: 10,
    color: rgb(0.23, 0.51, 0.96),
  });
  y -= 60;

  // Local helper just for StandardFonts (as pdfHelpers uses custom interface)
  const drawText = (page: any, text: string, options: any) => {
    const sanitized = sanitizeMathSymbols(text);
    try {
      page.drawText(sanitized, options);
    } catch {
      const strictText = sanitized.replace(/[^\x20-\x7E]/g, "");
      try {
        page.drawText(strictText, options);
      } catch {}
    }
  };

  drawText(summaryPage, "WORKSPHERE EXPENSE SUMMARY", {
    x: 130,
    y,
    size: 22,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  y -= 15;
  drawText(summaryPage, "BOOKING HISTORY EXPORT", {
    x: 165,
    y,
    size: 8,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });
  y -= 12;
  drawText(
    summaryPage,
    "ESTIMATE ONLY - $15/HR FLAT RATE, 8% FLAT TAX - VERIFY AGAINST YOUR INVOICES",
    { x: 50, y, size: 7, font, color: rgb(0.6, 0.2, 0.2) },
  );
  y -= 50;

  drawText(summaryPage, `TOTAL BOOKINGS: ${bookings.length}`, {
    x: 50,
    y,
    size: 12,
    font: boldFont,
  });
  y -= 20;

  let overallSubtotal = 0;
  let overallTax = 0;
  let overallTotal = 0;
  for (const booking of bookings) {
    const hours = booking.duration || 1;
    const price = hours * 15;
    const tax = Number((price * 0.08).toFixed(2));
    const total = Number((price + tax).toFixed(2));
    overallSubtotal += price;
    overallTax += tax;
    overallTotal += total;
  }

  drawText(
    summaryPage,
    `SUBTOTAL: $${overallSubtotal.toFixed(2)}  |  TAX (8%): $${overallTax.toFixed(2)}  |  TOTAL: $${overallTotal.toFixed(2)}`,
    { x: 50, y, size: 10, font: boldFont },
  );
  y -= 30;
  drawText(summaryPage, "-".repeat(60), { x: 50, y, size: 10, font });
  y -= 25;

  let currentPage = summaryPage;
  for (const booking of bookings) {
    if (y < 80) {
      // Create a new page on overflow to prevent text overlapping on a single summary page (fixes #532)
      currentPage = pdfDoc.addPage([595, 842]);
      y = height - 50;
    }
    const hours = booking.duration || 1;
    const price = hours * 15;
    const tax = Number((price * 0.08).toFixed(2));
    const total = Number((price + tax).toFixed(2));

    drawText(
      currentPage,
      `${safeText(booking.confirmationId || `WS-#${booking.id}`)}  |  ${safeText(booking.venue.name)}  |  CODE: ${safeText(booking.projectBillingCode || "N/A")}  |  $${total.toFixed(2)}`,
      { x: 50, y, size: 9, font },
    );
    y -= 18;
  }

  // One detailed page per booking
  for (const booking of bookings) {
    const page = pdfDoc.addPage([595, 842]);
    const { width: w, height: h } = page.getSize();
    let py = h - 50;

    const customerName = booking.user
      ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim()
      : "";

    page.drawRectangle({
      x: 0,
      y: h - 10,
      width: w,
      height: 10,
      color: rgb(0.23, 0.51, 0.96),
    });
    py -= 60;

    drawText(page, "WORKSPHERE CONFIRMATION", {
      x: 150,
      y: py,
      size: 24,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    py -= 15;
    drawText(page, "SECURE TRANSACTION RECEIPT", {
      x: 190,
      y: py,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    py -= 50;

    drawText(page, "BOOKING DETAILS:", {
      x: 50,
      y: py,
      size: 12,
      font: boldFont,
    });
    py -= 15;
    drawText(page, "-".repeat(50), { x: 50, y: py, size: 10, font });
    py -= 20;
    drawText(
      page,
      `REFERENCE ID: ${safeText(booking.confirmationId || `WS-#${booking.id}`)}`,
      { x: 50, y: py, size: 10, font },
    );
    py -= 18;
    const venueText = `VENUE: ${safeText(booking.venue.name)}`;
    const venueLines = breakTextIntoLines(
      venueText,
      [" ", ",", "-"],
      495,
      (t) => font.widthOfTextAtSize(t, 10),
    );

    for (const line of venueLines) {
      drawText(page, line, {
        x: 50,
        y: py,
        size: 10,
        font,
      });
      py -= 12;
    }
    py -= 6;
    drawText(
      page,
      `CATEGORY: ${safeText(booking.venue.category?.toUpperCase() || "WORKSPACE")}`,
      { x: 50, y: py, size: 10, font },
    );
    py -= 18;
    drawText(
      page,
      `ADDRESS: ${safeText(booking.venue.address || "Verified Workspace")}`,
      { x: 50, y: py, size: 10, font },
    );
    py -= 18;
    drawText(
      page,
      `SCHEDULE: ${safeText(booking.date)} @ ${safeText(booking.time)}`,
      { x: 50, y: py, size: 10, font },
    );
    py -= 18;
    drawText(
      page,
      `BILLING CODE: ${safeText(booking.projectBillingCode || "N/A")}`,
      { x: 50, y: py, size: 10, font },
    );
    py -= 18;
    drawText(
      page,
      `CUSTOMER: ${safeText(customerName || booking.customerEmail || "N/A")}`,
      { x: 50, y: py, size: 10, font },
    );
    py -= 30;

    const hours = booking.duration || 1;
    const price = hours * 15;
    const tax = Number((price * 0.08).toFixed(2));
    const total = Number((price + tax).toFixed(2));

    drawText(page, "PRICING & MEMBERSHIP CHARGES:", {
      x: 50,
      y: py,
      size: 12,
      font: boldFont,
    });
    py -= 15;
    drawText(page, "-".repeat(50), { x: 50, y: py, size: 10, font });
    py -= 20;
    drawText(page, `HOURLY RATE: $15.00/hr (DURATION: ${hours} hrs)`, {
      x: 50,
      y: py,
      size: 10,
      font,
    });
    py -= 18;
    drawText(page, `SUBTOTAL: $${price.toFixed(2)}`, {
      x: 50,
      y: py,
      size: 10,
      font,
    });
    py -= 18;
    drawText(page, `TAX (8%): $${tax.toFixed(2)}`, {
      x: 50,
      y: py,
      size: 10,
      font,
    });
    py -= 18;
    drawText(page, `TOTAL EXPENSED: $${total.toFixed(2)}`, {
      x: 50,
      y: py,
      size: 10,
      font: boldFont,
    });
    py -= 30;

    drawText(
      page,
      "Estimate based on a standard hourly rate; verify against the venue's invoice.",
      { x: 50, y: py, size: 8, font, color: rgb(0.42, 0.45, 0.5) },
    );
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

import fs from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";

export async function generateReceiptPdf(booking: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const page = pdfDoc.addPage([595, 842]);

  const regularFontPath = path.join(
    process.cwd(),
    "public",
    "fonts",
    "NotoSans-Regular.ttf",
  );
  const boldFontPath = path.join(
    process.cwd(),
    "public",
    "fonts",
    "NotoSans-Bold.ttf",
  );

  let font: any;
  let boldFont: any;

  try {
    const [regularFontBytes, boldFontBytes] = await Promise.all([
      fs.promises.readFile(regularFontPath),
      fs.promises.readFile(boldFontPath),
    ]);
    font = await pdfDoc.embedFont(regularFontBytes);
    boldFont = await pdfDoc.embedFont(boldFontBytes);
  } catch {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  const { width, height } = page.getSize();
  let yPosition = height - 50;

  const customerName = booking.user
    ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim()
    : "";

  const drawText = (text: string, options: PDFPageDrawTextOptions) => {
    const sanitized = sanitizeMathSymbols(text);
    try {
      page.drawText(sanitized, options);
    } catch {
      const strictText = sanitized.replace(/[^\x20-\x7E]/g, "");
      try {
        page.drawText(strictText, options);
      } catch {}
    }
  };

  const accent = rgb(0.23, 0.51, 0.96);
  const muted = rgb(0.42, 0.45, 0.5);
  const left = 50;
  const valueX = 190;
  const maxValueWidth = width - valueX - left;

  page.drawRectangle({
    x: 0,
    y: height - 10,
    width,
    height: 10,
    color: accent,
  });
  yPosition -= 30;

  drawText("WorkSphere", {
    x: left,
    y: yPosition,
    size: 22,
    font: boldFont,
    color: accent,
  });
  drawText("Booking confirmation", {
    x: width - left - boldFont.widthOfTextAtSize("Booking confirmation", 14),
    y: yPosition + 4,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  yPosition -= 40;

  page.drawLine({
    start: { x: left, y: yPosition },
    end: { x: width - left, y: yPosition },
    thickness: 0.5,
    color: rgb(0.85, 0.87, 0.9),
  });
  yPosition -= 28;

  const status = String(booking.status || "CONFIRMED");
  const rows: [string, string][] = [
    ["Confirmation", booking.confirmationId || booking.id],
    ["Status", status.charAt(0) + status.slice(1).toLowerCase()],
    ["Venue", booking.venue?.name || "Workspace"],
    ["Address", booking.venue?.address || "—"],
    ["Date", booking.date],
    [
      "Arrival time",
      booking.timeZone ? `${booking.time} (${booking.timeZone})` : booking.time,
    ],
    ["Booked by", customerName || booking.customerEmail || "—"],
    ["Email", booking.customerEmail || "—"],
  ];
  if (booking.projectBillingCode) {
    rows.push(["Billing code", booking.projectBillingCode]);
  }
  if (booking.createdAt) {
    rows.push([
      "Booked on",
      new Date(booking.createdAt).toISOString().slice(0, 10),
    ]);
  }

  for (const [label, value] of rows) {
    drawText(label, { x: left, y: yPosition, size: 10, font, color: muted });
    const lines = breakTextIntoLines(
      String(value),
      [" ", ",", "-"],
      maxValueWidth,
      (t) => font.widthOfTextAtSize(t, 11),
    );
    for (const line of lines) {
      drawText(line, { x: valueX, y: yPosition, size: 11, font: boldFont });
      yPosition -= 15;
    }
    yPosition -= 7;
  }

  yPosition -= 20;
  drawText("Good to know", { x: left, y: yPosition, size: 12, font: boldFont });
  yPosition -= 18;
  const notes = [
    "Show this confirmation number at the venue if asked.",
    "Free cancellation up to 2 hours before your arrival time from your WorkSphere dashboard.",
  ];
  for (const note of notes) {
    drawText(`• ${note}`, {
      x: left,
      y: yPosition,
      size: 10,
      font,
      color: muted,
    });
    yPosition -= 15;
  }

  drawText("Thank you for using WorkSphere.", {
    x: left,
    y: 50,
    size: 9,
    font,
    color: muted,
  });

  return await pdfDoc.save();
}

export async function generateGuestListPdf(
  booking: any,
  guests: any[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const regularFontPath = path.join(
    process.cwd(),
    "public",
    "fonts",
    "NotoSans-Regular.ttf",
  );
  const boldFontPath = path.join(
    process.cwd(),
    "public",
    "fonts",
    "NotoSans-Bold.ttf",
  );

  let font: any;
  let boldFont: any;

  try {
    const [regularFontBytes, boldFontBytes] = await Promise.all([
      fs.promises.readFile(regularFontPath),
      fs.promises.readFile(boldFontPath),
    ]);
    font = await pdfDoc.embedFont(regularFontBytes);
    boldFont = await pdfDoc.embedFont(boldFontBytes);
  } catch {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  const customerName = booking.user
    ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim()
    : booking.customerEmail || "N/A";

  const addPage = (pageNum: number, totalPages: number) => {
    const page = pdfDoc.addPage([595, 842]);
    const { width, height } = page.getSize();
    let yPosition = height - 50;

    const drawText = (text: string, options: PDFPageDrawTextOptions) => {
      const sanitized = sanitizeMathSymbols(text);
      try {
        page.drawText(sanitized, options);
      } catch {
        const strictText = sanitized.replace(/[^\x20-\x7E]/g, "");
        try {
          page.drawText(strictText, options);
        } catch {}
      }
    };

    // Header blue bar
    page.drawRectangle({
      x: 0,
      y: height - 10,
      width,
      height: 10,
      color: rgb(0.23, 0.51, 0.96),
    });
    yPosition -= 40;

    // Header content
    drawText("GUEST LIST", {
      x: 50,
      y: yPosition,
      size: 24,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    drawText(booking.venue?.name || "Verified Workspace", {
      x: 400,
      y: yPosition + 5,
      size: 14,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPosition -= 20;

    drawText(
      `CONFIRMATION ID: ${booking.confirmationId || "WS-#" + booking.id}`,
      {
        x: 50,
        y: yPosition,
        size: 10,
        font,
        color: rgb(0.3, 0.3, 0.3),
      },
    );

    drawText(`EVENT DATE: ${booking.date} @ ${booking.time}`, {
      x: 400,
      y: yPosition,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });

    yPosition -= 15;

    drawText(`HOST: ${customerName}`, {
      x: 50,
      y: yPosition,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });

    yPosition -= 30;

    // Footer
    const timestamp = new Date().toISOString();
    drawText(`Generated on ${timestamp}`, {
      x: 50,
      y: 30,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    drawText(`Page ${pageNum} of ${totalPages}`, {
      x: 500,
      y: 30,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    return { page, drawText, yPosition };
  };

  // Pagination logic
  const itemsPerPage = 30;
  const totalPages = Math.max(1, Math.ceil(guests.length / itemsPerPage));

  for (let p = 0; p < totalPages; p++) {
    const { page, drawText, yPosition: initialY } = addPage(p + 1, totalPages);
    let currentY = initialY;

    // Table Header
    drawText("Name", { x: 50, y: currentY, size: 10, font: boldFont });
    drawText("Email", { x: 200, y: currentY, size: 10, font: boldFont });
    drawText("Phone", { x: 380, y: currentY, size: 10, font: boldFont });
    drawText("Status", { x: 480, y: currentY, size: 10, font: boldFont });

    currentY -= 15;

    page.drawLine({
      start: { x: 50, y: currentY + 5 },
      end: { x: 545, y: currentY + 5 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });

    currentY -= 10;

    // Table Rows
    const startIndex = p * itemsPerPage;
    const pageGuests = guests.slice(startIndex, startIndex + itemsPerPage);

    for (const guest of pageGuests) {
      drawText(guest.name || "N/A", { x: 50, y: currentY, size: 9, font });

      // truncate email if too long
      const email = guest.email || "N/A";
      const displayEmail =
        email.length > 28 ? email.substring(0, 25) + "..." : email;
      drawText(displayEmail, { x: 200, y: currentY, size: 9, font });

      drawText(guest.phone || "N/A", { x: 380, y: currentY, size: 9, font });

      let statusColor = rgb(0.5, 0.5, 0.5);
      if (guest.status === "ACCEPTED") statusColor = rgb(0.1, 0.6, 0.1);
      if (guest.status === "DECLINED") statusColor = rgb(0.8, 0.1, 0.1);

      drawText(guest.status || "PENDING", {
        x: 480,
        y: currentY,
        size: 9,
        font: boldFont,
        color: statusColor,
      });

      currentY -= 20;
    }
  }

  return await pdfDoc.save();
}
