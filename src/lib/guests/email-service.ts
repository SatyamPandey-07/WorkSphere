/**
 * Guest Email Service
 *
 * Handles sending ICS calendar invitations to guests via email.
 * Uses the project's existing Nodemailer transport (configured in SMTP env vars).
 *
 * Integration with the existing email flow:
 * - Reuses SMTP_USER / SMTP_PASS / SMTP_HOST / SMTP_PORT env vars
 * - Same transport configuration as src/core/subscribers/booking.ts
 *
 * If the project adds a dedicated email service provider later,
 * only this module needs to be updated.
 */

import nodemailer from "nodemailer";

// =============================================================================
// SMTP Configuration
// =============================================================================

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

function getSmtpConfig(): SmtpConfig | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn("[GuestEmail] SMTP not configured — skipping email send");
    return null;
  }

  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "465", 10),
    secure: process.env.SMTP_PORT !== "587", // 465 = secure, 587 = STARTTLS
    user,
    pass,
    fromName: process.env.SMTP_FROM_NAME || "WorkSphere Concierge",
    fromEmail: process.env.SMTP_FROM_EMAIL || "noreply@worksphere.io",
  };
}

function createTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

// =============================================================================
// Email Building
// =============================================================================

interface InviteEmailParams {
  guestEmail: string;
  guestName?: string;
  hostName: string;
  venueName: string;
  venueAddress: string;
  date: string;
  time: string;
  durationMinutes: number;
  icsContent: string;
  directionsUrl: string;
  venuePhotoUrl?: string;
  bookingRef: string;
}

/**
 * Builds the email HTML body for a guest invitation.
 */
function buildInviteHtml(params: InviteEmailParams): string {
  const {
    guestName,
    hostName,
    venueName,
    venueAddress,
    date,
    time,
    durationMinutes,
    directionsUrl,
    venuePhotoUrl,
    bookingRef,
  } = params;

  const greeting = guestName ? `Hi ${guestName},` : "Hello,";
  const durationLabel =
    durationMinutes >= 60
      ? `${Math.floor(durationMinutes / 60)}h${durationMinutes % 60 > 0 ? ` ${durationMinutes % 60}m` : ""}`
      : `${durationMinutes} minutes`;

  const photoHtml = venuePhotoUrl
    ? `<div style="margin: 20px 0;">
         <img src="${venuePhotoUrl}" alt="${venueName}" style="width: 100%; max-width: 560px; border-radius: 12px; height: auto;" />
       </div>`
    : "";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 20px 0;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #7c3aed, #6d28d9); padding: 30px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">You're Invited!</h1>
                  <p style="color: #c4b5fd; margin: 8px 0 0 0; font-size: 14px;">Workspace Session at ${venueName}</p>
                </td>
              </tr>
              <!-- Content -->
              <tr>
                <td style="padding: 30px;">
                  <p style="font-size: 16px; color: #18181b; margin: 0 0 20px 0;">${greeting}</p>
                  <p style="font-size: 14px; color: #52525b; margin: 0 0 20px 0;">
                    <strong>${hostName}</strong> has invited you to a workspace session at <strong>${venueName}</strong>.
                  </p>

                  <!-- Event Details -->
                  <table width="100%" cellpadding="12" cellspacing="0" style="background: #f4f4f5; border-radius: 12px; margin: 20px 0;">
                    <tr>
                      <td style="padding: 12px 16px; border-bottom: 1px solid #e4e4e7;">
                        <span style="color: #71717a; font-size: 12px;">DATE</span>
                        <p style="color: #18181b; font-size: 14px; font-weight: 600; margin: 2px 0 0 0;">${date}</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 16px; border-bottom: 1px solid #e4e4e7;">
                        <span style="color: #71717a; font-size: 12px;">TIME</span>
                        <p style="color: #18181b; font-size: 14px; font-weight: 600; margin: 2px 0 0 0;">${time} (${durationLabel})</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 16px;">
                        <span style="color: #71717a; font-size: 12px;">LOCATION</span>
                        <p style="color: #18181b; font-size: 14px; font-weight: 600; margin: 2px 0 0 0;">${venueAddress || venueName}</p>
                      </td>
                    </tr>
                  </table>

                  ${photoHtml}

                  <!-- Map Button -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" style="padding: 10px 0;">
                        <a href="${directionsUrl}" target="_blank" style="display: inline-block; background: #7c3aed; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                          Get Directions
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="font-size: 13px; color: #a1a1aa; margin: 20px 0 0 0; text-align: center;">
                    Reference: ${bookingRef} &bull; The calendar invite is attached to this email.
                  </p>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background: #f4f4f5; padding: 20px; text-align: center;">
                  <p style="font-size: 12px; color: #a1a1aa; margin: 0;">Powered by <strong>WorkSphere</strong></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Send a calendar invitation email to a guest.
 *
 * @param params - Guest invitation parameters
 * @returns Object with success status and error message if applicable
 */
export async function sendGuestInvite(
  params: InviteEmailParams,
): Promise<{ success: boolean; error?: string }> {
  const config = getSmtpConfig();

  if (!config) {
    return { success: false, error: "SMTP not configured" };
  }

  try {
    const transporter = createTransport(config);

    const html = buildInviteHtml(params);
    const icsFilename = `workspace-invite-${params.date}.ics`;

    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: params.guestEmail,
      subject: `You're invited to a workspace session at ${params.venueName}`,
      html,
      attachments: [
        {
          filename: icsFilename,
          content: params.icsContent,
          contentType: "text/calendar; charset=utf-8; method=PUBLISH",
        },
      ],
    });

    return { success: true };
  } catch (error: any) {
    console.error("[GuestEmail] Failed to send invite:", error);
    return {
      success: false,
      error: error?.message || "Unknown email error",
    };
  }
}
