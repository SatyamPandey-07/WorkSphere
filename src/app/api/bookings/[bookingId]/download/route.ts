import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ bookingId: string }> }
) {
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
            },
        });

        if (!booking) {
            return NextResponse.json({ error: "Booking not found" }, { status: 404 });
        }

        // Generate PDF Receipt
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([595, 842]); // A4 size
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const { width, height } = page.getSize();
        let yPosition = height - 50;

        // Helper to sanitize text
        const safeText = (text: string) => text ? text.replace(/[^\x00-\x7F]/g, "?") : "";

        // Top blue bar
        page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: rgb(0.23, 0.51, 0.96) });
        yPosition -= 60;

        // Title
        page.drawText("WORKSPHERE CONFIRMATION", { x: 150, y: yPosition, size: 24, font: boldFont, color: rgb(0, 0, 0) });
        yPosition -= 15;
        page.drawText("SECURE NEURAL TRANSACTION RECEIPT", { x: 180, y: yPosition, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
        yPosition -= 50;

        // Booking Details
        page.drawText("BOOKING DETAILS:", { x: 50, y: yPosition, size: 12, font: boldFont });
        yPosition -= 15;
        page.drawText("-".repeat(50), { x: 50, y: yPosition, size: 10, font });
        yPosition -= 20;
        page.drawText(`REFERENCE ID: ${booking.confirmationId || `WS-#${booking.id}`}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText(`VENUE: ${safeText(booking.venue.name)}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText(`CATEGORY: ${safeText(booking.venue.category?.toUpperCase() || "WORKSPACE")}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText(`ADDRESS: ${safeText(booking.venue.address || "Verified Workspace")}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText(`SCHEDULE: ${booking.date} @ ${booking.time}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText(`CUSTOMER: ${safeText(booking.customerEmail || "N/A")}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 40;

        // Security Protocol
        page.drawText("SECURITY PROTOCOL:", { x: 50, y: yPosition, size: 12, font: boldFont });
        yPosition -= 18;
        page.drawText("ZERO-FEE ACCESS PROTOCOL ACTIVE", { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText("ENCRYPTED VIA WORKSPHERE L3", { x: 50, y: yPosition, size: 10, font });
        yPosition -= 80;

        // Footer
        page.drawText("Thank you for choosing WorkSphere. Your workspace is ready for you.", { x: 100, y: yPosition, size: 8, font, color: rgb(0.4, 0.4, 0.4) });

        const pdfBytes = await pdfDoc.save();

        // Return PDF with proper headers
        return new NextResponse(Buffer.from(pdfBytes), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="WorkSphere_Receipt_${booking.confirmationId || booking.id}.pdf"`,
                "Cache-Control": "no-cache",
            },
        });
    } catch (error) {
        console.error("[Booking Download Error]:", error);
        return NextResponse.json(
            { error: "Failed to generate receipt" },
            { status: 500 }
        );
    }
}
