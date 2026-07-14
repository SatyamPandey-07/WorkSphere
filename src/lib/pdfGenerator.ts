import {
  PDFDocument,
  rgb,
  StandardFonts,
  PDFPageDrawTextOptions,
} from "pdf-lib";
import { safeText } from "./pdfHelpers";

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
    try {
      page.drawText(text, options);
    } catch {
      const strictText = text.replace(/[^\x20-\x7E]/g, "?");
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
  drawText(summaryPage, "CONSOLIDATED NEURAL LEDGER EXPORT", {
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

  for (const booking of bookings) {
    if (y < 80) {
      y = height - 50;
    }
    const hours = booking.duration || 1;
    const price = hours * 15;
    const tax = Number((price * 0.08).toFixed(2));
    const total = Number((price + tax).toFixed(2));

    drawText(
      summaryPage,
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
    drawText(page, `VENUE: ${safeText(booking.venue.name)}`, {
      x: 50,
      y: py,
      size: 10,
      font,
    });
    py -= 18;
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
    py -= 40;

    drawText(page, "SECURITY PROTOCOL:", {
      x: 50,
      y: py,
      size: 12,
      font: boldFont,
    });
    py -= 18;
    drawText(page, "MEMBERSHIP EXPENSE VALIDATION ACTIVE", {
      x: 50,
      y: py,
      size: 10,
      font,
    });
    py -= 18;
    drawText(page, "ENCRYPTED VIA WORKSPHERE SECURE PROT", {
      x: 50,
      y: py,
      size: 10,
      font,
    });
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
    const regularFontBytes = fs.readFileSync(regularFontPath);
    const boldFontBytes = fs.readFileSync(boldFontPath);
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
  drawText("SECURE NEURAL TRANSACTION RECEIPT", {
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
  drawText(`VENUE: ${booking.venue.name}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 18;
  drawText(
    `CATEGORY: ${booking.venue.category?.toUpperCase() || "WORKSPACE"}`,
    { x: 50, y: yPosition, size: 10, font },
  );
  yPosition -= 18;
  drawText(`ADDRESS: ${booking.venue.address || "Verified Workspace"}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 18;
  drawText(`SCHEDULE: ${booking.date} @ ${booking.time}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 18;
  drawText(`BILLING CODE: ${booking.projectBillingCode || "N/A"}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 18;
  drawText(`CUSTOMER: ${customerName || booking.customerEmail || "N/A"}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 40;

  drawText("SECURITY PROTOCOL:", {
    x: 50,
    y: yPosition,
    size: 12,
    font: boldFont,
  });
  yPosition -= 18;
  drawText("ZERO-FEE ACCESS PROTOCOL ACTIVE", {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 18;
  drawText("ENCRYPTED VIA WORKSPHERE L3", {
    x: 50,
    y: yPosition,
    size: 10,
    font,
  });
  yPosition -= 80;

  drawText(
    "Thank you for choosing WorkSphere. Your workspace is ready for you.",
    { x: 100, y: yPosition, size: 8, font, color: rgb(0.4, 0.4, 0.4) },
  );

  return await pdfDoc.save();
}
