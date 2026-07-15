import { ensureUserExists } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  PDFDocument,
  PDFFont,
  PDFPageDrawTextOptions,
  StandardFonts,
  rgb,
} from "pdf-lib";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ bookingId: string }> },
) {
  let pdfDoc: PDFDocument | null = null;
  let pdfBytes: Uint8Array | null = null;
  let pdfBuffer: Buffer | null = null;
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure Identity 💎
    await ensureUserExists(userId);

    const { bookingId } = await context.params;

    // Fetch the booking (bookingId is a cuid string)
    const booking = await (prisma as any).booking.findFirst({
      where: {
        id: bookingId,
        userId, // Ensure user owns this booking
      },
      include: {
        venue: true,
        user: true,
      },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // Generate PDF Receipt
    pdfDoc = await PDFDocument.create();
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

    let font: PDFFont;
    let boldFont: PDFFont;

    try {
      const regularFontBytes = fs.readFileSync(regularFontPath);
      const boldFontBytes = fs.readFileSync(boldFontPath);

      font = await pdfDoc.embedFont(regularFontBytes);
      boldFont = await pdfDoc.embedFont(boldFontBytes);
    } catch (err) {
      console.warn(
        "Failed to load Noto Sans fonts, falling back to Helvetica.",
        err,
      );

      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    const { width, height } = page.getSize();
    let yPosition = height - 50;

    const customerName = booking.user
      ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim()
      : "";

    // Helper to draw text with absolute safety against encoding crashes
    const drawSafeText = (text: string, options: PDFPageDrawTextOptions) => {
      try {
        page.drawText(text, options);
      } catch (err) {
        console.warn(
          "[PDF drawText warning]: Failed to draw text, retrying with strict sanitization",
          err,
        );
        try {
          const strictText = text.replace(/[^\x20-\x7E]/g, "?");
          page.drawText(strictText, options);
        } catch (fallbackErr) {
          console.error(
            "[PDF drawText critical error]: Failed to draw text even with strict sanitization",
            fallbackErr,
          );
        }
      }
    };

    // Top blue bar
    page.drawRectangle({
      x: 0,
      y: height - 10,
      width,
      height: 10,
      color: rgb(0.23, 0.51, 0.96),
    });
    yPosition -= 60;

    // Title
    drawSafeText("WORKSPHERE CONFIRMATION", {
      x: 150,
      y: yPosition,
      size: 24,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    yPosition -= 15;
    drawSafeText("SECURE NEURAL TRANSACTION RECEIPT", {
      x: 180,
      y: yPosition,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    yPosition -= 50;

    // Booking Details
    drawSafeText("BOOKING DETAILS:", {
      x: 50,
      y: yPosition,
      size: 12,
      font: boldFont,
    });
    yPosition -= 15;
    drawSafeText("-".repeat(50), { x: 50, y: yPosition, size: 10, font });
    yPosition -= 20;
    drawSafeText(
      `REFERENCE ID: ${booking.confirmationId || `WS-#${booking.id}`}`,
      { x: 50, y: yPosition, size: 10, font },
    );
    yPosition -= 18;
    drawSafeText(`VENUE: ${booking.venue.name}`, {
      x: 50,
      y: yPosition,
      size: 10,
      font,
    });
    yPosition -= 18;
    drawSafeText(
      `CATEGORY: ${booking.venue.category?.toUpperCase() || "WORKSPACE"}`,
      { x: 50, y: yPosition, size: 10, font },
    );
    yPosition -= 18;
    drawSafeText(`ADDRESS: ${booking.venue.address || "Verified Workspace"}`, {
      x: 50,
      y: yPosition,
      size: 10,
      font,
    });
    yPosition -= 18;
    drawSafeText(`SCHEDULE: ${booking.date} @ ${booking.time}`, {
      x: 50,
      y: yPosition,
      size: 10,
      font,
    });
    yPosition -= 18;
    drawSafeText(`BILLING CODE: ${booking.projectBillingCode || "N/A"}`, {
      x: 50,
      y: yPosition,
      size: 10,
      font,
    });
    yPosition -= 18;
    drawSafeText(
      `CUSTOMER: ${customerName || booking.customerEmail || "N/A"}`,
      { x: 50, y: yPosition, size: 10, font },
    );
    yPosition -= 40;

    // Security Protocol
    drawSafeText("SECURITY PROTOCOL:", {
      x: 50,
      y: yPosition,
      size: 12,
      font: boldFont,
    });
    yPosition -= 18;
    drawSafeText("ZERO-FEE ACCESS PROTOCOL ACTIVE", {
      x: 50,
      y: yPosition,
      size: 10,
      font,
    });
    yPosition -= 18;
    drawSafeText("ENCRYPTED VIA WORKSPHERE L3", {
      x: 50,
      y: yPosition,
      size: 10,
      font,
    });
    yPosition -= 80;

    // Footer
    drawSafeText(
      "Thank you for choosing WorkSphere. Your workspace is ready for you.",
      { x: 100, y: yPosition, size: 8, font, color: rgb(0.4, 0.4, 0.4) },
    );

    pdfBytes = await pdfDoc.save();
    pdfBuffer = Buffer.from(pdfBytes);

    // Return PDF with proper headers - use Uint8Array (valid BodyInit) instead of Node Buffer
    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="WorkSphere_Receipt_${booking.confirmationId || booking.id}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
        "Cache-Control": "no-cache",
      },
    });
  } catch (error: any) {
    console.error("[Booking Download Error]:", error);
    return NextResponse.json(
      { error: "Failed to generate receipt" },
      { status: 500 },
    );
  } finally {
    // Explicitly clear references for immediate garbage collection
    pdfDoc = null;
    pdfBytes = null;
    pdfBuffer = null;

    // Trigger garbage collection if exposed/available
    if (typeof global !== "undefined" && (global as any).gc) {
      try {
        (global as any).gc();
      } catch (gcErr) {
        console.warn("[PDF GC Warning]: Failed to trigger global.gc()", gcErr);
      }
    }
  }
}
