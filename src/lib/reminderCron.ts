import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import nodemailer from "nodemailer";
import { getRedis } from "./redis";
import { isWithinNotificationWindow } from "./notificationWindow";
import { appUrl } from "./appUrl";
import { escapeHtml } from "./html";
import { bookingStartsAt } from "./bookingTime";

export interface ReminderClaimResult {
  claimed: boolean;
  claimToken?: string;
}

interface InMemoryReminderEntry {
  state: "claimed" | "sent";
  token: string;
  expiresAt: number;
}

// Fallback idempotency store for deployments without Redis (single instance only).
// NOTE: Single-process in-memory fallback cannot coordinate across multi-instance serverless deployments.
// Production environments MUST configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
const sentInMemory = new Map<string, InMemoryReminderEntry>();

/**
 * Reset in-memory cache for deterministic unit test isolation.
 */
export function _clearSentInMemory(): void {
  sentInMemory.clear();
}

/**
 * Atomically attempts to claim a reminder delivery slot.
 * Uses Redis `SET key value NX EX claimTtlSeconds` so only ONE concurrent worker can succeed.
 *
 * @param key Unique reminder idempotency key (e.g. `booking-reminder:${bookingId}`)
 * @param claimTtlSeconds Lock holding duration during active dispatch (default: 300s / 5m)
 * @param redisClient Optional Redis instance
 */
export async function claimReminderDelivery(
  key: string,
  claimTtlSeconds: number = 300,
  redisClient?: ReturnType<typeof getRedis>,
): Promise<ReminderClaimResult> {
  const claimToken = randomUUID();
  const redis = redisClient !== undefined ? redisClient : getRedis();

  if (redis) {
    try {
      const res = await redis.set(key, `claimed:${claimToken}`, {
        nx: true,
        ex: claimTtlSeconds,
      });
      if (res === "OK" || res === true) {
        return { claimed: true, claimToken };
      }
      return { claimed: false };
    } catch (err) {
      console.warn(
        `[reminderCron] Redis claim failed for ${key}, falling back to memory:`,
        err,
      );
    }
  }

  // In-memory fallback
  const now = Date.now();
  const existing = sentInMemory.get(key);
  if (existing && existing.expiresAt > now) {
    return { claimed: false };
  }

  sentInMemory.set(key, {
    state: "claimed",
    token: claimToken,
    expiresAt: now + claimTtlSeconds * 1000,
  });

  return { claimed: true, claimToken };
}

/**
 * Transitions a successfully dispatched reminder to the committed "sent" state.
 * Extends the TTL for the full deduplication window (e.g. 1-2 hours) so future sweeps skip it.
 */
export async function markReminderSent(
  key: string,
  claimToken: string,
  successTtlSeconds: number = 7200,
  redisClient?: ReturnType<typeof getRedis>,
): Promise<void> {
  const redis = redisClient !== undefined ? redisClient : getRedis();

  if (redis) {
    try {
      await redis.set(key, "sent", { ex: successTtlSeconds });
      return;
    } catch (err) {
      console.warn(
        `[reminderCron] Redis markSent failed for ${key}, falling back to memory:`,
        err,
      );
    }
  }

  sentInMemory.set(key, {
    state: "sent",
    token: claimToken,
    expiresAt: Date.now() + successTtlSeconds * 1000,
  });
}

/**
 * Releases a claimed reminder delivery when dispatch fails, allowing immediate retry.
 * Only releases if the claim token matches the caller's token.
 */
export async function releaseReminderClaim(
  key: string,
  claimToken: string,
  redisClient?: ReturnType<typeof getRedis>,
): Promise<void> {
  const redis = redisClient !== undefined ? redisClient : getRedis();

  if (redis) {
    try {
      const current = await redis.get<string>(key);
      if (current === `claimed:${claimToken}`) {
        await redis.del(key);
      }
      return;
    } catch (err) {
      console.warn(
        `[reminderCron] Redis release failed for ${key}, falling back to memory:`,
        err,
      );
    }
  }

  const existing = sentInMemory.get(key);
  if (existing && existing.token === claimToken) {
    sentInMemory.delete(key);
  }
}

export async function wasSent(
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
  const entry = sentInMemory.get(key);
  return entry !== undefined && entry.expiresAt > Date.now();
}

export async function markSent(
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
  sentInMemory.set(key, {
    state: "sent",
    token: "legacy",
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
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
      const claim = await claimReminderDelivery(key, 300, redis);
      if (!claim.claimed || !claim.claimToken) {
        continue;
      }

      let emailSent = false;
      try {
        emailSent = await sendEmailAlert(booking);
        if (emailSent) {
          await markReminderSent(key, claim.claimToken, 2 * 60 * 60, redis);
          sent++;
        } else {
          await releaseReminderClaim(key, claim.claimToken, redis);
        }
      } catch (err) {
        await releaseReminderClaim(key, claim.claimToken, redis);
        throw err;
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
