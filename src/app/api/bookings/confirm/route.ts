import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { trackEvent } from "@/lib/analytics";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";

// ─── Constants & Clients ──────────────────────────────────────────────────

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

export async function POST(req: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 0. Ensure Identity 💎
        await ensureUserExists(userId);

        const { venue, date, time, customerEmail, customerPhone } = await req.json();

        if (!venue) {
            return NextResponse.json({ error: "Missing venue data" }, { status: 400 });
        }

        const confirmationId = `WS-#${Math.floor(100000 + Math.random() * 900000)}`;
        const targetPlaceId = venue.placeId || venue.id;

        // 0.5 Ensure Venue exists in local ledger 💎
        // Venues from search might not be in our DB yet
        // We upsert by placeId because that is the unique physical identifier
        const dbVenue = await prisma.venue.upsert({
            where: { placeId: targetPlaceId },
            update: {
                // Update basic info if it's missing or from a fresh search
                name: venue.name || "Unknown Venue",
                address: venue.address || null,
                category: venue.category || "other",
            },
            create: {
                placeId: targetPlaceId,
                name: venue.name || "Unknown Venue",
                latitude: venue.latitude || venue.lat || 0,
                longitude: venue.longitude || venue.lng || 0,
                category: venue.category || "other",
                address: venue.address || null,
            },
        });

        // 1. Persist to Database 💎
        const booking = await (prisma as any).booking.create({
            data: {
                userId,
                venueId: dbVenue.id, // Use the ID from our verified ledger record
                date,
                time,
                customerEmail: customerEmail || "pandeysatyam1802@gmail.com",
                customerPhone: customerPhone || null,
                confirmationId,
            }
        });

        // 2. Generate PDF Receipt in Memory (Serverless-Compatible with pdf-lib)
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
        page.drawText(`REFERENCE ID: ${confirmationId}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText(`VENUE: ${safeText(venue.name)}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText(`CATEGORY: ${safeText(venue.category?.toUpperCase() || "WORKSPACE")}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText(`ADDRESS: ${safeText(venue.address || "Verified Workspace")}`, { x: 50, y: yPosition, size: 10, font });
        yPosition -= 18;
        page.drawText(`SCHEDULE: ${date} @ ${time}`, { x: 50, y: yPosition, size: 10, font });
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

        const pdfBuffer = Buffer.from(await pdfDoc.save());

        // 3. Transmit Email via Nodemailer (Official Receipt)
        if (SMTP_USER && SMTP_PASS && (customerEmail || "pandeysatyam1802@gmail.com")) {
            try {
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST || "smtp.gmail.com",
                    port: parseInt(process.env.SMTP_PORT || "465"),
                    secure: true,
                    auth: { user: SMTP_USER, pass: SMTP_PASS },
                });

                await transporter.sendMail({
                    from: '"WorkSphere Concierge" <noreply@worksphere.io>',
                    to: customerEmail || "pandeysatyam1802@gmail.com",
                    subject: `Confirmed: Workspace at ${venue.name}`,
                    text: `Your spot at ${venue.name} is confirmed for ${date} at ${time}. Your official receipt is attached.`,
                    attachments: [
                        {
                            filename: `WorkSphere_Receipt_${booking.id}.pdf`,
                            content: pdfBuffer,
                        },
                    ],
                });
                console.log("[Nodemailer] Email Dispatched to:", customerEmail || "pandeysatyam1802@gmail.com");
            } catch (smtpErr) {
                console.error("[Nodemailer Error]:", smtpErr);
            }
        }

        // 4. Analytics Telemetry
        trackEvent("venue_viewed", { venueId: venue.id, action: "booking_confirmed_neural_ledger" });

        return NextResponse.json({
            success: true,
            bookingId: booking.id,
            confirmationId
        });
    } catch (error: any) {
        console.error("[Booking API Critical Failure]:", error);
        return NextResponse.json({
            success: false,
            error: "Internal systems error during confirmation",
            details: error.message || String(error)
        }, { status: 500 });
    }
}
