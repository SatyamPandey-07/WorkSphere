import { prisma } from "./prisma";
import nodemailer from "nodemailer";
import { getRedis } from "./redis";
import { isWithinNotificationWindow } from "./notificationWindow";
import { appUrl } from "./appUrl";
import { escapeHtml } from "./html";
import { bookingStartsAt } from "./bookingTime";

// Fallback idempotency store for deployments without Redis (single instance only).
const sentInMemory = new Map<string, number>();

async function wasSent(
  key: string,
  redisClient?: ReturnType<typeof getRedis>,
): Promise<boolean> {
  const redis = redisClient !== undefined ? redisClient : getRedis();
  if (redis) {
    try {
      return Boolean(await redis.get(key));
    } catch {
      // fall through to memory
    }
  }
  const expiresAt = sentInMemory.get(key);
  return expiresAt !== undefined && expiresAt > Date.now();
}

async function markSent(
  key: string,
  ttlSeconds: number,
  redisClient?: ReturnType<typeof getRedis>,
): Promise<void> {
  const redis = redisClient !== undefined ? redisClient : getRedis();
  if (redis) {
    try {
      await redis.set(key, "sent", { ex: ttlSeconds });
      return;
    } catch {
      // fall through to memory
    }
  }
  sentInMemory.set(key, Date.now() + ttlSeconds * 1000);
}

export { parseBookingDateTime } from "./bookingTime";

async function sendEmailAlert(booking: {
  id: string;
  time: string;
  customerEmail: string;
  user: { firstName: string | null } | null;
  venue: {
    id: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
  };
}): Promise<boolean> {
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;

  if (!SMTP_USER || !SMTP_PASS || !booking.customerEmail) {
    console.log(
      `[Reminder Notification Skip] SMTP credentials or recipient email missing for booking ${booking.id}`,
    );
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const googleMapsLink = `https://www.google.com/maps/dir/?api=1&destination=${booking.venue.latitude},${booking.venue.longitude}`;
  const workSphereLink = appUrl(
    `/venues/${encodeURIComponent(booking.venue.id)}`,
  );
  const venueName = escapeHtml(booking.venue.name);

  await transporter.sendMail({
    from: `"WorkSphere" <${process.env.SMTP_FROM_EMAIL || SMTP_USER}>`,
    to: booking.customerEmail,
    subject: `Reminder: your workspace at ${booking.venue.name} starts soon`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2>Hi ${escapeHtml(booking.user?.firstName || "there")},</h2>
        <p>Your reservation at <strong>${venueName}</strong> starts in about 30 minutes (at ${escapeHtml(booking.time)}).</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <ul>
          <li><strong>Venue:</strong> ${venueName}</li>
          <li><strong>Address:</strong> ${escapeHtml(booking.venue.address || "No address provided")}</li>
          <li><strong>Time:</strong> ${escapeHtml(booking.time)}</li>
        </ul>
        <p>
          <a href="${workSphereLink}" style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 10px;">View venue</a>
          <a href="${googleMapsLink}" style="display: inline-block; background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold;">Get directions</a>
        </p>
      </div>
    `,
  });
  return true;
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Emails users whose reservation starts 15–45 minutes from now.
 * Booking times are interpreted in the booking owner's timezone.
 */
export async function processUpcomingReservationAlerts(
  now: Date = new Date(),
): Promise<{ checked: number; sent: number }> {
  // Lazy-initialize Redis instance with a null check
  let redis: ReturnType<typeof getRedis> = null;
  try {
    redis = getRedis();
  } catch (err) {
    console.warn(
      "[reminderCron] Redis lazy initialization failed, falling back to in-memory store:",
      err,
    );
  }

  const day = 24 * 60 * 60 * 1000;
  // A booking's local date can be a day either side of the UTC date.
  const candidateDates = [
    isoDate(new Date(now.getTime() - day)),
    isoDate(now),
    isoDate(new Date(now.getTime() + day)),
  ];

  const bookings = await prisma.booking.findMany({
    where: {
      date: { in: candidateDates },
      status: "CONFIRMED",
    },
    include: {
      user: true,
      venue: true,
    },
  });

  const targetMin = now.getTime() + 15 * 60 * 1000;
  const targetMax = now.getTime() + 45 * 60 * 1000;
  let sent = 0;

  for (const booking of bookings) {
    try {
      const startsAt = bookingStartsAt(booking, booking.user?.timezone);
      if (!startsAt) continue;
      if (startsAt.getTime() < targetMin || startsAt.getTime() > targetMax) {
        continue;
      }

      const user = booking.user;
      if (
        user &&
        !isWithinNotificationWindow(
          now,
          user.notificationStart,
          user.notificationEnd,
          user.timezone,
        )
      ) {
        continue;
      }

      const key = `booking-reminder:${booking.id}`;
      if (await wasSent(key, redis)) continue;

      if (await sendEmailAlert(booking)) {
        await markSent(key, 2 * 60 * 60, redis);
        sent++;
      }
    } catch (err) {
      console.error(
        `Error processing booking reminder for ${booking.id}:`,
        err,
      );
    }
  }

  return { checked: bookings.length, sent };
}
