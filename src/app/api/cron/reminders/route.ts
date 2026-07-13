import { NextResponse } from 'next/server';
import { processUpcomingReservationAlerts } from '@/lib/reminderCron';
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";
import twilio from "twilio";
import { Redis } from "@upstash/redis";

// Setup Redis to track sent reminders
let redis: any = null;
try {
  redis = Redis.fromEnv();
} catch (e) {
  console.warn("Redis client could not be initialized from env:", e);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cronKey = searchParams.get('key');

  // Basic guard validation layer checking secret keys inside production server environments
  if (cronKey !== process.env.CRON_SECRET_TOKEN) {
    return new NextResponse('Unauthorized Endpoint Action', { status: 401 });
  }

  await processUpcomingReservationAlerts();
  return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
}

export async function POST(req: Request) {
  // Protect cron endpoint using authorization bearer secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);

    // Fetch collaborative sessions starting in the next 30 minutes
    const sessions = await prisma.coworkingSession.findMany({
      where: {
        startsAt: {
          gt: now,
          lte: thirtyMinutesFromNow,
        },
      },
      include: {
        host: true,
        venue: true,
        rsvps: {
          where: {
            status: {
              in: ["GOING", "MAYBE"],
            },
          },
          include: {
            user: true,
          },
        },
      },
    });

    let emailsSent = 0;
    let smsSent = 0;

    for (const session of sessions) {
      const redisKey = `session-reminder:${session.id}`;
      if (redis) {
        const alreadySent = await redis.get(redisKey);
        if (alreadySent) continue;
        // Mark as sent in Redis immediately to prevent duplicate runs
        await redis.set(redisKey, "sent", { ex: 3600 }); // Expire key in 1 hour
      }

      // Compile lists of recipients
      const recipients = [
        {
          email: session.host.email,
          phoneNumber: session.host.phoneNumber,
          smsAlertsEnabled: session.host.smsAlertsEnabled,
          name: `${session.host.firstName || "Nomad"} ${session.host.lastName || "Scout"}`,
        },
        ...session.rsvps.map((rsvp) => ({
          email: rsvp.user.email,
          phoneNumber: rsvp.user.phoneNumber,
          smsAlertsEnabled: rsvp.user.smsAlertsEnabled,
          name: `${rsvp.user.firstName || "Nomad"} ${rsvp.user.lastName || "Scout"}`,
        })),
      ].filter((r) => r.email); // Must have email to send email notice

      // Setup Nodemailer transporter
      const SMTP_USER = process.env.SMTP_USER;
      const SMTP_PASS = process.env.SMTP_PASS;
      let transporter: nodemailer.Transporter | null = null;
      if (SMTP_USER && SMTP_PASS) {
        transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || "smtp.gmail.com",
          port: parseInt(process.env.SMTP_PORT || "587"),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
          },
        });
      }

      // Setup Twilio client
      const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
      const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
      const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
      let twilioClient: any = null;
      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
        twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      }

      // Format directions links
      const googleMapsLink = `https://www.google.com/maps/dir/?api=1&destination=${session.venue.latitude},${session.venue.longitude}`;
      const workSphereLink = `https://work-sphere-one.vercel.app/ai?venue=${session.venue.id}`;

      for (const recipient of recipients) {
        // 1. Dispatch Email Reminder
        if (transporter && recipient.email) {
          try {
            await transporter.sendMail({
              from: `"WorkSphere Reminders" <${SMTP_USER}>`,
              to: recipient.email,
              subject: `Reminder: Collaborative Session "${session.title}" starts soon!`,
              html: `
                <div style="font-family: sans-serif; padding: 20px; color: #333;">
                  <h2>Hi ${recipient.name},</h2>
                  <p>This is a reminder that the collaborative session <strong>"${session.title}"</strong> is scheduled to start in less than 30 minutes!</p>
                  <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                  <h3>Session details:</h3>
                  <ul>
                    <li><strong>Venue:</strong> ${session.venue.name}</li>
                    <li><strong>Time:</strong> ${session.startsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</li>
                    <li><strong>Address:</strong> ${session.venue.address || "No address provided"}</li>
                  </ul>
                  <p>
                    <a href="${workSphereLink}" style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 10px;">View in WorkSphere</a>
                    <a href="${googleMapsLink}" style="display: inline-block; background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold;">Get Directions</a>
                  </p>
                </div>
              `,
            });
            emailsSent++;
            console.log(`[Reminders Cron] Email dispatched to ${recipient.email}`);
          } catch (emailErr) {
            console.error(`[Reminders Cron] Nodemailer error for ${recipient.email}:`, emailErr);
          }
        }

        // 2. Dispatch SMS Reminder
        if (twilioClient && recipient.phoneNumber && recipient.smsAlertsEnabled) {
          try {
            await twilioClient.messages.create({
              body: `Reminder: The session "${session.title}" starts at ${session.startsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} at ${session.venue.name}. Get directions: ${googleMapsLink}`,
              to: recipient.phoneNumber,
              from: TWILIO_PHONE_NUMBER,
            });
            smsSent++;
            console.log(`[Reminders Cron] SMS dispatched to ${recipient.phoneNumber}`);
          } catch (smsErr) {
            console.error(`[Reminders Cron] Twilio error for ${recipient.phoneNumber}:`, smsErr);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      sessionsProcessed: sessions.length,
      emailsSent,
      smsSent,
    });
  } catch (error: any) {
    console.error("POST /api/cron/reminders error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
