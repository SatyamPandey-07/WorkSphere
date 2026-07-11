import { eventBus } from "../events";
import nodemailer from "nodemailer";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { trackEvent } from "@/lib/analytics";

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

eventBus.on("booking:confirmed", async (payload) => {
  const { bookingId, confirmationId, venue, customerEmail, date, time } = payload;
  const targetEmail = customerEmail || "pandeysatyam1802@gmail.com";

  try {
    // 1. Generate PDF Receipt in Memory
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    const { width, height } = page.getSize();
    let yPosition = height - 50;

    const safeText = (text: string) => text ? text.replace(/[^\x00-\x7F]/g, "?") : "";

    page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: rgb(0.23, 0.51, 0.96) });
    yPosition -= 60;

    page.drawText("WORKSPHERE CONFIRMATION", { x: 150, y: yPosition, size: 24, font: boldFont, color: rgb(0, 0, 0) });
    yPosition -= 15;
    page.drawText("SECURE NEURAL TRANSACTION RECEIPT", { x: 180, y: yPosition, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    yPosition -= 50;

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

    page.drawText("SECURITY PROTOCOL:", { x: 50, y: yPosition, size: 12, font: boldFont });
    yPosition -= 18;
    page.drawText("ZERO-FEE ACCESS PROTOCOL ACTIVE", { x: 50, y: yPosition, size: 10, font });
    yPosition -= 18;
    page.drawText("ENCRYPTED VIA WORKSPHERE L3", { x: 50, y: yPosition, size: 10, font });
    yPosition -= 80;

    page.drawText("Thank you for choosing WorkSphere. Your workspace is ready for you.", { x: 100, y: yPosition, size: 8, font, color: rgb(0.4, 0.4, 0.4) });

    const pdfBuffer = Buffer.from(await pdfDoc.save());

    // 2. Transmit Email via Nodemailer
    if (SMTP_USER && SMTP_PASS && targetEmail) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || "smtp.gmail.com",
          port: parseInt(process.env.SMTP_PORT || "465"),
          secure: true,
          auth: { user: SMTP_USER, pass: SMTP_PASS },
        });

        await transporter.sendMail({
          from: '"WorkSphere Concierge" <noreply@worksphere.io>',
          to: targetEmail,
          subject: `Confirmed: Workspace at ${venue.name}`,
          text: `Your spot at ${venue.name} is confirmed for ${date} at ${time}. Your official receipt is attached.`,
          attachments: [
            {
              filename: `WorkSphere_Receipt_${bookingId}.pdf`,
              content: pdfBuffer,
            },
          ],
        });
        console.log("[Nodemailer] Email Dispatched to:", targetEmail);
      } catch (smtpErr) {
        console.error("[Nodemailer Error]:", smtpErr);
      }
    }
  } catch (error) {
    console.error("[BookingConfirmedEvent] Error generating PDF or sending email:", error);
  }

  // 3. Analytics Telemetry
  try {
    trackEvent("venue_viewed", { venueId: venue.id, action: "booking_confirmed_neural_ledger" });
  } catch (error) {
    console.error("[BookingConfirmedEvent] Error tracking analytics:", error);
  }
});
