"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { isValidDiscordWebhookUrl } from "@/lib/discord";
import { isValidTelegramWebhookUrl } from "@/lib/telegram";
import { ensureUserExists } from "@/lib/auth";
import { isSafeWebhookUrl } from "@/lib/ssrfValidation";
import { deliverWebhookEvent } from "@/lib/webhooks/deliver";
import { rateLimit } from "@/lib/rateLimit";
import { WebhookEventType } from "@prisma/client";
import { z } from "zod";

const MAX_ENDPOINTS_PER_USER = 10;
const MAX_CUSTOM_HEADERS = 10;
// Headers the delivery pipeline sets itself; users may not override them.
const RESERVED_HEADERS = new Set([
  "content-type",
  "content-length",
  "host",
  "user-agent",
  "webhook-id",
  "webhook-timestamp",
  "webhook-signature",
  "svix-id",
  "svix-timestamp",
  "svix-signature",
]);

const createEndpointSchema = z.object({
  url: z.string().trim().url().max(2048),
  eventTypes: z
    .array(z.nativeEnum(WebhookEventType))
    .min(1, "Select at least one event"),
  headers: z.record(z.string(), z.string().max(1024)).optional(),
});

export type WebhookActionResult = { ok: true } | { ok: false; error: string };

export async function createWebhookEndpoint(data: {
  url: string;
  eventTypes: string[];
  headers?: Record<string, string>;
}): Promise<WebhookActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in again." };

  const parsed = createEndpointSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid webhook details",
    };
  }
  const { url, eventTypes, headers = {} } = parsed.data;

  if (process.env.NODE_ENV === "production" && !url.startsWith("https://")) {
    return { ok: false, error: "Webhook URLs must use HTTPS." };
  }

  const headerEntries = Object.entries(headers);
  if (headerEntries.length > MAX_CUSTOM_HEADERS) {
    return {
      ok: false,
      error: `At most ${MAX_CUSTOM_HEADERS} custom headers.`,
    };
  }
  for (const [key] of headerEntries) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) {
      return { ok: false, error: `Invalid header name "${key}".` };
    }
    if (RESERVED_HEADERS.has(key.toLowerCase())) {
      return { ok: false, error: `The "${key}" header is set automatically.` };
    }
  }

  const safetyCheck = await isSafeWebhookUrl(url);
  if (!safetyCheck.isSafe) {
    return { ok: false, error: `Invalid webhook URL: ${safetyCheck.reason}` };
  }

  await ensureUserExists(userId);

  const existing = await prisma.webhookEndpoint.count({ where: { userId } });
  if (existing >= MAX_ENDPOINTS_PER_USER) {
    return {
      ok: false,
      error: `You can register up to ${MAX_ENDPOINTS_PER_USER} endpoints.`,
    };
  }

  // Standard Webhooks secret: "whsec_" + base64 key.
  const secret = "whsec_" + crypto.randomBytes(24).toString("base64");

  await prisma.webhookEndpoint.create({
    data: {
      userId,
      url,
      secret,
      eventTypes,
      headers: headerEntries.length ? headers : undefined,
    },
  });

  revalidatePath("/dashboard/webhooks");
  return { ok: true };
}

export async function setWebhookEndpointActive(
  endpointId: string,
  isActive: boolean,
): Promise<WebhookActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in again." };

  const result = await prisma.webhookEndpoint.updateMany({
    where: { id: endpointId, userId },
    data: { isActive },
  });
  if (result.count === 0) return { ok: false, error: "Endpoint not found." };

  revalidatePath("/dashboard/webhooks");
  return { ok: true };
}

/** Sends a sample event to one of the caller's endpoints and reports the outcome. */
export async function sendTestWebhook(
  endpointId: string,
): Promise<
  | { ok: true; status: string; statusCode: number | null }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in again." };

  if (!(await rateLimit(`webhook-test:${userId}`, 5))) {
    return { ok: false, error: "Too many test events. Try again in a minute." };
  }

  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, userId },
  });
  if (!endpoint) return { ok: false, error: "Endpoint not found." };

  const type = endpoint.eventTypes[0] ?? WebhookEventType.VENUE_CREATED;
  const results = await deliverWebhookEvent(
    userId,
    type,
    { test: true, message: "This is a test event from WorkSphere." },
    { ignoreNotificationWindow: true, onlyEndpointId: endpoint.id },
  );
  const result = results.find((r) => r.endpointId === endpoint.id);

  revalidatePath("/dashboard/webhooks");
  return {
    ok: true,
    status: result?.status ?? "FAILED",
    statusCode: result?.statusCode ?? null,
  };
}

export async function getWebhookEndpoints() {
  const { userId } = await auth();
  if (!userId) return [];

  return await prisma.webhookEndpoint.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getWebhookLogs(endpointId: string) {
  const { userId } = await auth();
  if (!userId) return [];

  // Verify ownership
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: endpointId },
  });
  if (endpoint?.userId !== userId) return [];

  return await prisma.webhookDeliveryLog.findMany({
    where: { endpointId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

export async function deleteWebhookEndpoint(endpointId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  await prisma.webhookEndpoint.delete({
    where: { id: endpointId, userId },
  });

  revalidatePath("/dashboard/webhooks");
}
export async function saveDiscordWebhookUrl(url: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  await ensureUserExists(userId);

  const trimmed = url.trim();
  if (trimmed && !isValidDiscordWebhookUrl(trimmed)) {
    throw new Error("That doesn't look like a valid Discord webhook URL");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { discordWebhookUrl: trimmed || null },
  });

  revalidatePath("/dashboard/webhooks");
}
export async function getDiscordWebhookUrl() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { discordWebhookUrl: true },
  });

  return user?.discordWebhookUrl ?? null;
}

export async function saveTelegramWebhookUrl(url: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  await ensureUserExists(userId);

  const trimmed = url.trim();
  if (trimmed && !isValidTelegramWebhookUrl(trimmed)) {
    throw new Error("That doesn't look like a valid Telegram webhook URL");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { telegramWebhookUrl: trimmed || null },
  });

  revalidatePath("/dashboard/webhooks");
}

export async function getTelegramWebhookUrl() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramWebhookUrl: true },
  });

  return user?.telegramWebhookUrl ?? null;
}
