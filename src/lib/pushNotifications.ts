import webPush from "web-push";
import { prisma } from "@/lib/prisma";
import { resolveWebPushContentEncoding } from "@/lib/webPushContentEncoding";
import { isWithinNotificationWindow } from "@/lib/notificationWindow";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT ?? "mailto:admin@worksphere.app";

let isConfigured = false;

function configureVapid() {
  if (isConfigured) return;
  const pubKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY;
  const privKey = process.env.VAPID_PRIVATE_KEY || VAPID_PRIVATE_KEY;
  if (!pubKey || !privKey) {
    throw new Error("VAPID keys are not configured");
  }
  const subject = process.env.VAPID_SUBJECT || VAPID_SUBJECT;
  webPush.setVapidDetails(subject, pubKey, privKey);
  isConfigured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  isCritical?: boolean;
}

export interface PushNotificationOptions {
  isCritical?: boolean;
  force?: boolean;
  ignoreQuietHours?: boolean;
  now?: Date;
}

export interface PushNotificationResult {
  sent: number;
  failed: number;
  suppressed?: boolean;
  deferred?: boolean;
  reason?: string;
}

/**
 * Checks whether the current time falls within a user's quiet hours window.
 * Supports overnight windows (e.g. 22:00 to 07:00) and user timezone conversion.
 */
export function isWithinQuietHours(
  now: Date,
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
  timezone: string | null | undefined,
): boolean {
  if (!quietStart || !quietEnd) {
    return false;
  }

  const tz = timezone || "UTC";

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const formatted = formatter.format(now);
    const parts = formatted.split(":");
    let currentHour = parseInt(parts[0], 10);
    const currentMin = parseInt(parts[1], 10);
    if (currentHour === 24) currentHour = 0;
    const currentMinutes = currentHour * 60 + currentMin;

    const parseTimeToMinutes = (timeStr: string): number => {
      const match12 = timeStr.match(/^\s*(\d+):(\d+)\s*(AM|PM)\s*$/i);
      if (match12) {
        let h = parseInt(match12[1], 10);
        const m = parseInt(match12[2], 10);
        const ampm = match12[3].toUpperCase();
        if (ampm === "PM" && h < 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        return h * 60 + m;
      }

      const match24 = timeStr.match(/^\s*(\d+):(\d+)\s*$/);
      if (match24) {
        return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
      }
      return 0;
    };

    const startMinutes = parseTimeToMinutes(quietStart);
    const endMinutes = parseTimeToMinutes(quietEnd);

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Overnight quiet hours (e.g. 22:00 to 07:00)
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  } catch (error) {
    console.error(`Error calculating quiet hours for timezone ${tz}:`, error);
    return false;
  }
}

/**
 * Determines whether push notifications for a user should be suppressed
 * based on quiet hours or allowed notification windows.
 */
export function isUserInQuietHours(
  now: Date,
  user: {
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    notificationStart?: string | null;
    notificationEnd?: string | null;
    timezone?: string | null;
  } | null | undefined,
): boolean {
  if (!user) return false;

  if (user.quietHoursStart && user.quietHoursEnd) {
    return isWithinQuietHours(
      now,
      user.quietHoursStart,
      user.quietHoursEnd,
      user.timezone,
    );
  }

  if (user.notificationStart && user.notificationEnd) {
    return !isWithinNotificationWindow(
      now,
      user.notificationStart,
      user.notificationEnd,
      user.timezone,
    );
  }

  return false;
}

export async function sendPushNotification(
  userId: string,
  payload: PushPayload,
  options?: PushNotificationOptions,
): Promise<PushNotificationResult> {
  const isCritical = Boolean(
    payload.isCritical ||
      options?.isCritical ||
      options?.force ||
      options?.ignoreQuietHours,
  );

  // Check user quiet hours before dispatching non-critical notifications
  if (!isCritical) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        quietHoursStart: true,
        quietHoursEnd: true,
        notificationStart: true,
        notificationEnd: true,
        timezone: true,
      },
    });

    const checkTime = options?.now ?? new Date(Date.now());
    if (isUserInQuietHours(checkTime, user)) {
      await prisma.pushNotificationLog.create({
        data: {
          userId,
          venueId: (payload.data?.venueId as string) ?? null,
          title: payload.title,
          body: payload.body,
          status: "DEFERRED_QUIET_HOURS",
          error: "Notification suppressed during user quiet hours",
        },
      });

      return {
        sent: 0,
        failed: 0,
        suppressed: true,
        deferred: true,
        reason: "QUIET_HOURS",
      };
    }
  }

  configureVapid();

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  let sent = 0;
  let failed = 0;

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    icon: payload.icon ?? "/icons/icon.svg",
    badge: payload.badge ?? "/icons/icon.svg",
    tag: payload.tag ?? "worksphere-notification",
    data: payload.data ?? {},
  });

  const staleEndpoints: string[] = [];

  for (const sub of subscriptions) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    };

    try {
      // Safari iOS 17.4: aes128gcm decrypt fails → blank notifications (#1032).
      // Prefer aesgcm for Apple/Safari; aes128gcm for other push services.
      const contentEncoding = resolveWebPushContentEncoding({
        endpoint: sub.endpoint,
        userAgent: sub.userAgent,
      });

      await webPush.sendNotification(pushSubscription, notificationPayload, {
        contentEncoding,
      });
      await prisma.pushSubscription.update({
        where: { id: sub.id },
        data: { lastUsedAt: new Date() },
      });
      sent++;
    } catch (error: unknown) {
      failed++;
      const statusCode =
        error && typeof error === "object" && "statusCode" in error
          ? (error as { statusCode: number }).statusCode
          : null;

      if (statusCode === 404 || statusCode === 410) {
        staleEndpoints.push(sub.endpoint);
      }
    }
  }

  if (staleEndpoints.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: { in: staleEndpoints } },
    });
  }

  await prisma.pushNotificationLog.create({
    data: {
      userId,
      venueId: (payload.data?.venueId as string) ?? null,
      title: payload.title,
      body: payload.body,
      status: failed === subscriptions.length ? "FAILED" : "SENT",
      error: failed > 0 ? `${failed} subscriptions failed` : null,
    },
  });

  return { sent, failed, suppressed: false, deferred: false };
}

export async function sendVenueAvailabilityNotification(
  venueId: string,
  venueName: string,
  availableSeats: number,
): Promise<void> {
  const favorites = await prisma.favorite.findMany({
    where: { venueId },
    select: { userId: true },
  });

  for (const favorite of favorites) {
    await sendPushNotification(favorite.userId, {
      title: "Seat Available!",
      body: `${venueName} now has ${availableSeats} seat${availableSeats !== 1 ? "s" : ""} available.`,
      url: `/venues/${venueId}`,
      tag: `venue-availability-${venueId}`,
      data: { venueId, venueName, availableSeats },
    });
  }
}

export function generateVapidKeys() {
  return webPush.generateVAPIDKeys();
}
