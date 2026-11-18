import webPush from "web-push";
import { prisma } from "@/lib/prisma";
import { resolveWebPushContentEncoding } from "@/lib/webPushContentEncoding";
import { isWithinNotificationWindow } from "@/lib/notificationWindow";
import type {
  NotificationChannel,
  NotificationMessage,
  DeliveryResult,
  PushPayload,
  PushNotificationOptions,
  PushNotificationResult,
} from "../types";

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

export function isWithinQuietHours(
  now: Date,
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
  timezone: string | null | undefined,
): boolean {
  if (!quietStart || !quietEnd) return false;

  const [startH, startM] = quietStart.split(":").map(Number);
  const [endH, endM] = quietEnd.split(":").map(Number);

  let userHours = now.getUTCHours();
  let userMinutes = now.getUTCMinutes();

  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).formatToParts(now);

      const hPart = parts.find((p) => p.type === "hour");
      const mPart = parts.find((p) => p.type === "minute");

      if (hPart && mPart) {
        userHours = parseInt(hPart.value, 10);
        userMinutes = parseInt(mPart.value, 10);
      }
    } catch {}
  }

  const currentMinutes = userHours * 60 + userMinutes;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * Determines whether push notifications for a user should be suppressed
 * based on quiet hours or allowed notification windows.
 */
export function isUserInQuietHours(
  now: Date,
  user:
    | {
        quietHoursStart?: string | null;
        quietHoursEnd?: string | null;
        notificationStart?: string | null;
        notificationEnd?: string | null;
        timezone?: string | null;
      }
    | null
    | undefined,
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

export class WebPushNotificationChannel implements NotificationChannel {
  public readonly name = "webpush";

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const userId = message.recipient;
    if (!userId) {
      return {
        channel: this.name,
        status: "FAILED",
        error: "Missing userId recipient for webpush notification",
      };
    }

    const payload: PushPayload = {
      title: message.title || "WorkSphere",
      body: message.body || "",
      url: message.url,
      data: message.data,
      isCritical: (message.options?.isCritical as boolean) || false,
    };

    const res = await sendPushNotification(
      userId,
      payload,
      message.options as PushNotificationOptions,
    );

    if (res.deferred || res.suppressed) {
      return {
        channel: this.name,
        status: "SKIPPED_OUTSIDE_WINDOW",
        recipient: userId,
        details: { reason: res.reason },
      };
    }

    return {
      channel: this.name,
      status: res.sent > 0 ? "SUCCESS" : "FAILED",
      recipient: userId,
      details: { sent: res.sent, failed: res.failed },
    };
  }
}

export const webPushNotificationChannel = new WebPushNotificationChannel();

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
