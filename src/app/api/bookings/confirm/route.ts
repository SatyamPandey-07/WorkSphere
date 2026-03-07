import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
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

        // 2. Generate PDF Receipt in Memory
        const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50 });
            const chunks: any[] = [];
            doc.on("data", (chunk) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", (err) => reject(err));

            // Helper to sanitize text for PDFKit (Helvetica doesn't support Unicode/CJK)
            const safeText = (text: string) => text ? text.replace(/[^\x00-\x7F]/g, "?") : "";

            // Neural Design Branding
            doc.rect(0, 0, doc.page.width, 10).fill("#3b82f6");
            doc.moveDown(2);
            doc.fontSize(25).font("Helvetica-Bold").text("WORKSPHERE CONFIRMATION", { align: "center", characterSpacing: 2 });
            doc.moveDown(0.2);
            doc.fontSize(8).font("Helvetica").fillOpacity(0.5).text("SECURE NEURAL TRANSACTION RECEIPT", { align: "center" });
            doc.fillOpacity(1);

            doc.moveDown(3);
            doc.fontSize(10).font("Helvetica-Bold").text("BOOKING DETAILS:");
            doc.font("Helvetica").text("--------------------------------------------------");
            doc.text(`REFERENCE ID: ${confirmationId}`);
            doc.text(`VENUE: ${safeText(venue.name)}`);
            doc.text(`CATEGORY: ${safeText(venue.category?.toUpperCase() || "WORKSPACE")}`);
            doc.text(`ADDRESS: ${safeText(venue.address || "Verified Workspace")}`);
            doc.text(`SCHEDULE: ${date} @ ${time}`);

            doc.moveDown(2);
            doc.font("Helvetica-Bold").text("SECURITY PROTOCOL:");
            doc.font("Helvetica").text("ZERO-FEE ACCESS PROTOCOL ACTIVE");
            doc.text("ENCRYPTED VIA WORKSPHERE L3");

            doc.moveDown(5);
            doc.fontSize(8).fill("#666666").text("Thank you for choosing WorkSphere. Your workspace is ready for you.", { align: "center" });

            doc.end();
        });

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
