import { eventBus } from "../events";
import nodemailer, { type Transporter } from "nodemailer";
import { trackEvent } from "@/lib/analytics";
import { prisma } from "@/lib/prisma";
import { generateReceiptPdf } from "@/lib/pdfGenerator";
import { appUrl } from "@/lib/appUrl";
import { escapeHtml } from "@/lib/html";

function createTransport(): Transporter | null {
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;
  const port = parseInt(process.env.SMTP_PORT || "465");
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === "true"
      : port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/** Emails the booker a confirmation with the PDF receipt attached. */
eventBus.on("booking:confirmed", async (payload) => {
  const { bookingId, venue, customerEmail, date, time } = payload;

  const transporter = createTransport();
  if (transporter && customerEmail) {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { venue: true, user: true },
      });
      if (booking) {
        const pdf = await generateReceiptPdf(booking);
        const fromAddress =
          process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
        const dashboardLink = appUrl("/dashboard");

        await transporter.sendMail({
          from: `"WorkSphere" <${fromAddress}>`,
          to: customerEmail,
          subject: `Confirmed: ${venue.name} on ${date} at ${time}`,
          text: `Your spot at ${venue.name} is confirmed for ${date} at ${time}. Confirmation: ${booking.confirmationId}. Manage your booking: ${dashboardLink}`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2>You're booked at ${escapeHtml(venue.name)}</h2>
              <p><strong>${escapeHtml(date)}</strong> at <strong>${escapeHtml(time)}</strong></p>
              <p>Confirmation number: <strong>${escapeHtml(booking.confirmationId)}</strong></p>
              ${venue.address ? `<p>${escapeHtml(venue.address)}</p>` : ""}
              <p>Your receipt is attached. You can cancel for free up to 2 hours before your arrival time.</p>
              <p><a href="${dashboardLink}" style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold;">Manage booking</a></p>
            </div>
          `,
          attachments: [
            {
              filename: `WorkSphere_Receipt_${booking.confirmationId}.pdf`,
              content: Buffer.from(pdf),
            },
          ],
        });
      }
    } catch (error) {
      console.error(
        "[BookingConfirmedEvent] Failed to send confirmation email:",
        error,
      );
    }
  }

  try {
    trackEvent("venue_viewed", {
      venueId: venue.id,
      action: "booking_confirmed",
    });
  } catch (error) {
    console.error("[BookingConfirmedEvent] Error tracking analytics:", error);
  }
});
