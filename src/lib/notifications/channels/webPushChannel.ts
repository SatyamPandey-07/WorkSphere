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

export async function sendPushNotification(
  userId: string,
  payload: PushPayload,
  options: PushNotificationOptions = {},
): Promise<PushNotificationResult> {
  const prefs = await prisma.userNotificationPreference.findUnique({
    where: { userId },
  });

  const now = options.now ?? new Date();

  if (prefs?.timezone && prefs.notificationWindowStart && prefs.notificationWindowEnd) {
    const inWindow = isWithinNotificationWindow(
      now,
      prefs.notificationWindowStart,
      prefs.notificationWindowEnd,
      prefs.timezone,
    );
    if (!inWindow && !options.isCritical && !options.force) {
      return {
        sent: 0,
        failed: 0,
        deferred: true,
        reason: "outside_notification_window",
      };
    }
  }

  const isQuiet =
    !options.ignoreQuietHours &&
    !options.isCritical &&
    isWithinQuietHours(
      now,
      prefs?.quietHoursStart,
      prefs?.quietHoursEnd,
      prefs?.timezone,
    );

  if (isQuiet && !options.force) {
    return {
      sent: 0,
      failed: 0,
      suppressed: true,
      reason: "quiet_hours",
    };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0 };
  }

  try {
    configureVapid();
  } catch {
    return { sent: 0, failed: subscriptions.length };
  }

  const payloadString = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      const contentEncoding = resolveWebPushContentEncoding(
        sub.contentEncoding,
        sub.endpoint,
      );

      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webPush.sendNotification(
          pushSubscription,
          payloadString,
          {
            contentEncoding,
            TTL: 86400,
            urgency: options.isCritical ? "high" : "normal",
          } as any,
        );
        sent++;
      } catch (err: any) {
        failed++;
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
        }
      }
    }),
  );

  return { sent, failed };
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

    const res = await sendPushNotification(userId, payload, message.options as PushNotificationOptions);

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
