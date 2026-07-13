import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { drawSafeText, safeText, bookingsToCSV } from "@/lib/pdfHelpers";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureUserExists(userId);

    const { bookingIds, format } = await req.json();

    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return NextResponse.json({ error: "No bookings selected" }, { status: 400 });
    }
    if (format !== "pdf" && format !== "csv") {
      return NextResponse.json({ error: "Invalid format" }, { status: 400 });
    }

    // Only fetch bookings that belong to this user - never trust client-supplied ownership
    const bookings = await (prisma as any).booking.findMany({
      where: {
        id: { in: bookingIds },
        userId,
      },
      include: { venue: true, user: true },
      orderBy: { createdAt: "desc" },
    });

    if (bookings.length === 0) {
      return NextResponse.json({ error: "No matching bookings found" }, { status: 404 });
    }

    if (format === "csv") {
      const csv = bookingsToCSV(bookings);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="WorkSphere_Expenses_${Date.now()}.csv"`,
          "Cache-Control": "no-cache",
        },
      });
    }

    // PDF path
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Summary page
    const summaryPage = pdfDoc.addPage([595, 842]);
    const { width, height } = summaryPage.getSize();
    let y = height - 50;

    summaryPage.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: rgb(0.23, 0.51, 0.96) });
    y -= 60;
    drawSafeText(summaryPage, "WORKSPHERE EXPENSE SUMMARY", { x: 130, y, size: 22, font: boldFont, color: rgb(0, 0, 0) });
    y -= 15;
    drawSafeText(summaryPage, "CONSOLIDATED NEURAL LEDGER EXPORT", { x: 165, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    y -= 50;

    drawSafeText(summaryPage, `TOTAL BOOKINGS: ${bookings.length}`, { x: 50, y, size: 12, font: boldFont });
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

    drawSafeText(summaryPage, `SUBTOTAL: $${overallSubtotal.toFixed(2)}  |  TAX (8%): $${overallTax.toFixed(2)}  |  TOTAL: $${overallTotal.toFixed(2)}`, { x: 50, y, size: 10, font: boldFont });
    y -= 30;
    drawSafeText(summaryPage, "-".repeat(60), { x: 50, y, size: 10, font });
    y -= 25;

    for (const booking of bookings) {
      if (y < 80) {
        y = height - 50;
      }
      const hours = booking.duration || 1;
      const price = hours * 15;
      const tax = Number((price * 0.08).toFixed(2));
      const total = Number((price + tax).toFixed(2));

      drawSafeText(
        summaryPage,
        `${safeText(booking.confirmationId || `WS-#${booking.id}`)}  |  ${safeText(booking.venue.name)}  |  $${total.toFixed(2)}`,
        { x: 50, y, size: 9, font }
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

      page.drawRectangle({ x: 0, y: h - 10, width: w, height: 10, color: rgb(0.23, 0.51, 0.96) });
      py -= 60;

      drawSafeText(page, "WORKSPHERE CONFIRMATION", { x: 150, y: py, size: 24, font: boldFont, color: rgb(0, 0, 0) });
      py -= 15;
      drawSafeText(page, "SECURE TRANSACTION RECEIPT", { x: 190, y: py, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
      py -= 50;

      drawSafeText(page, "BOOKING DETAILS:", { x: 50, y: py, size: 12, font: boldFont });
      py -= 15;
      drawSafeText(page, "-".repeat(50), { x: 50, y: py, size: 10, font });
      py -= 20;
      drawSafeText(page, `REFERENCE ID: ${safeText(booking.confirmationId || `WS-#${booking.id}`)}`, { x: 50, y: py, size: 10, font });
      py -= 18;
      drawSafeText(page, `VENUE: ${safeText(booking.venue.name)}`, { x: 50, y: py, size: 10, font });
      py -= 18;
      drawSafeText(page, `CATEGORY: ${safeText(booking.venue.category?.toUpperCase() || "WORKSPACE")}`, { x: 50, y: py, size: 10, font });
      py -= 18;
      drawSafeText(page, `ADDRESS: ${safeText(booking.venue.address || "Verified Workspace")}`, { x: 50, y: py, size: 10, font });
      py -= 18;
      drawSafeText(page, `SCHEDULE: ${safeText(booking.date)} @ ${safeText(booking.time)}`, { x: 50, y: py, size: 10, font });
      py -= 18;
      drawSafeText(page, `CUSTOMER: ${safeText(customerName || booking.customerEmail || "N/A")}`, { x: 50, y: py, size: 10, font });
      py -= 30;

      const hours = booking.duration || 1;
      const price = hours * 15;
      const tax = Number((price * 0.08).toFixed(2));
      const total = Number((price + tax).toFixed(2));

      drawSafeText(page, "PRICING & MEMBERSHIP CHARGES:", { x: 50, y: py, size: 12, font: boldFont });
      py -= 15;
      drawSafeText(page, "-".repeat(50), { x: 50, y: py, size: 10, font });
      py -= 20;
      drawSafeText(page, `HOURLY RATE: $15.00/hr (DURATION: ${hours} hrs)`, { x: 50, y: py, size: 10, font });
      py -= 18;
      drawSafeText(page, `SUBTOTAL: $${price.toFixed(2)}`, { x: 50, y: py, size: 10, font });
      py -= 18;
      drawSafeText(page, `TAX (8%): $${tax.toFixed(2)}`, { x: 50, y: py, size: 10, font });
      py -= 18;
      drawSafeText(page, `TOTAL EXPENSED: $${total.toFixed(2)}`, { x: 50, y: py, size: 10, font: boldFont });
      py -= 40;

      drawSafeText(page, "SECURITY PROTOCOL:", { x: 50, y: py, size: 12, font: boldFont });
      py -= 18;
      drawSafeText(page, "MEMBERSHIP EXPENSE VALIDATION ACTIVE", { x: 50, y: py, size: 10, font });
      py -= 18;
      drawSafeText(page, "ENCRYPTED VIA WORKSPHERE SECURE PROT", { x: 50, y: py, size: 10, font });
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="WorkSphere_Expenses_${Date.now()}.pdf"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error: any) {
    console.error("[Bookings Export Error]:", error);
    return NextResponse.json({ error: "Failed to generate export" }, { status: 500 });
  }
}