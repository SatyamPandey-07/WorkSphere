import { NextResponse } from "next/server";
import nodemailer, { type Transporter } from "nodemailer";
import twilio from "twilio";
import { processUpcomingReservationAlerts } from "@/lib/reminderCron";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { isWithinNotificationWindow } from "@/lib/notificationWindow";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { appUrl } from "@/lib/appUrl";
import { escapeHtml } from "@/lib/html";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function createMailer(): Transporter | null {
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function createSmsClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } =
    process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return null;
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

const sentInMemory = new Set<string>();

async function alreadyNotified(key: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      return Boolean(await redis.get(key));
    } catch {
      // fall back to memory
    }
  }
  return sentInMemory.has(key);
}

async function markNotified(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, "sent", { ex: 3600 });
      return;
    } catch {
      // fall back to memory
    }
  }
  sentInMemory.add(key);
}

/** Reminds hosts and attendees of coworking sessions starting within 30 minutes. */
async function processSessionReminders(now: Date) {
  const soon = new Date(now.getTime() + 30 * 60 * 1000);
  const sessions = await prisma.coworkingSession.findMany({
    where: { startsAt: { gt: now, lte: soon } },
    include: {
      host: true,
      venue: true,
      rsvps: {
        where: { status: { in: ["GOING", "MAYBE"] } },
        include: { user: true },
      },
    },
  });

  const mailer = createMailer();
  const sms = createSmsClient();
  let emailsSent = 0;
  let smsSent = 0;

  for (const session of sessions) {
    const people = [session.host, ...session.rsvps.map((r) => r.user)];
    const googleMapsLink = `https://www.google.com/maps/dir/?api=1&destination=${session.venue.latitude},${session.venue.longitude}`;
    const sessionLink = appUrl(`/sessions/${encodeURIComponent(session.slug)}`);

    for (const person of people) {
      if (!person.email) continue;
      const key = `session-reminder:${session.id}:${person.id}`;
      if (await alreadyNotified(key)) continue;

      if (
        !isWithinNotificationWindow(
          now,
          person.notificationStart,
          person.notificationEnd,
          person.timezone,
        )
      ) {
        continue;
      }

      const startTime = session.startsAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: person.timezone || "UTC",
      });
      let dispatched = false;

      if (mailer) {
        try {
          await mailer.sendMail({
            from: `"WorkSphere" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
            to: person.email,
            subject: `Reminder: "${session.title}" starts soon`,
            html: `
              <div style="font-family: sans-serif; padding: 20px; color: #333;">
                <h2>Hi ${escapeHtml(person.firstName || "there")},</h2>
                <p>The coworking session <strong>${escapeHtml(session.title)}</strong> starts in less than 30 minutes.</p>
                <ul>
                  <li><strong>Venue:</strong> ${escapeHtml(session.venue.name)}</li>
                  <li><strong>Time:</strong> ${escapeHtml(startTime)}</li>
                  <li><strong>Address:</strong> ${escapeHtml(session.venue.address || "No address provided")}</li>
                </ul>
                <p>
                  <a href="${sessionLink}" style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 10px;">View session</a>
                  <a href="${googleMapsLink}" style="display: inline-block; background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold;">Get directions</a>
                </p>
              </div>
            `,
          });
          emailsSent++;
          dispatched = true;
        } catch (err) {
          console.error(
            `[Reminders Cron] email to ${person.email} failed:`,
            err,
          );
        }
      }

      if (sms && person.phoneNumber && person.smsAlertsEnabled) {
        try {
          await sms.messages.create({
            body: `Reminder: "${session.title}" starts at ${startTime} at ${session.venue.name}. Directions: ${googleMapsLink}`,
            to: person.phoneNumber,
            from: process.env.TWILIO_PHONE_NUMBER,
          });
          smsSent++;
          dispatched = true;
        } catch (err) {
          console.error(`[Reminders Cron] SMS to ${person.id} failed:`, err);
        }
      }

      if (dispatched) await markNotified(key);
    }
  }

  return { sessionsProcessed: sessions.length, emailsSent, smsSent };
}

async function run(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const bookings = await processUpcomingReservationAlerts(now);
    const sessions = await processSessionReminders(now);

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      bookingRemindersSent: bookings.sent,
      ...sessions,
    });
  } catch (error) {
    console.error("/api/cron/reminders error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// Vercel Cron issues GET requests; POST is kept for external schedulers.
export const GET = run;
export const POST = run;
