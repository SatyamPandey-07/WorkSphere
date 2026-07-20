import webPush from "web-push";
import { prisma } from "@/lib/prisma";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@worksphere.app";

let isConfigured = false;

function configureVapid() {
  if (isConfigured) return;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error("VAPID keys are not configured");
  }
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
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
}

export async function sendPushNotification(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
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
      await webPush.sendNotification(pushSubscription, notificationPayload);
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

  return { sent, failed };
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
