import { createHmac, randomUUID } from "crypto";
import { after } from "next/server";
import type { WebhookEndpoint, WebhookEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSafeWebhookUrl } from "@/lib/ssrfValidation";
import { isWithinNotificationWindow } from "@/lib/notificationWindow";

const DELIVERY_TIMEOUT_MS = 5_000;

export interface WebhookEnvelope {
  id: string;
  type: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface DeliveryResult {
  endpointId: string;
  status: "SUCCESS" | "FAILED" | "BLOCKED" | "SKIPPED_OUTSIDE_WINDOW";
  statusCode: number | null;
}

/**
 * Standard Webhooks signature (identical to Svix's): base64 HMAC-SHA256 of
 * "{id}.{timestamp}.{body}" keyed with the base64-decoded part of "whsec_…".
 */
export function signWebhookPayload(
  secret: string,
  id: string,
  timestampSeconds: string,
  body: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const digest = createHmac("sha256", key)
    .update(`${id}.${timestampSeconds}.${body}`)
    .digest("base64");
  return `v1,${digest}`;
}

function customHeaders(endpoint: WebhookEndpoint): Record<string, string> {
  const raw = endpoint.headers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(key)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * POSTs a signed event to a single endpoint.
 *
 * Signatures follow the Standard Webhooks scheme (the same one Svix uses), so
 * receivers can verify with any Svix / standard-webhooks library using the
 * endpoint's `whsec_…` secret.
 */
async function deliverToEndpoint(
  endpoint: WebhookEndpoint,
  envelope: WebhookEnvelope,
): Promise<DeliveryResult> {
  const body = JSON.stringify(envelope);
  let status: DeliveryResult["status"] = "FAILED";
  let statusCode: number | null = null;

  // Re-validate at send time: DNS may have changed since the URL was saved.
  const safety = await isSafeWebhookUrl(endpoint.url);
  if (!safety.isSafe) {
    status = "BLOCKED";
  } else {
    try {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = signWebhookPayload(
        endpoint.secret,
        envelope.id,
        timestamp,
        body,
      );

      const res = await fetch(endpoint.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        headers: {
          ...customHeaders(endpoint),
          "content-type": "application/json",
          "user-agent": "WorkSphere-Webhooks/1.0",
          "webhook-id": envelope.id,
          "webhook-timestamp": timestamp,
          "webhook-signature": signature,
          "svix-id": envelope.id,
          "svix-timestamp": timestamp,
          "svix-signature": signature,
        },
        body,
      });
      statusCode = res.status;
      status = res.ok ? "SUCCESS" : "FAILED";
    } catch (err) {
      console.error(
        `[webhooks] delivery to endpoint ${endpoint.id} failed:`,
        err,
      );
    }
  }

  await prisma.webhookDeliveryLog
    .create({
      data: {
        endpointId: endpoint.id,
        eventType: envelope.type,
        payload: envelope as any,
        status,
        statusCode,
      },
    })
    .catch((err) => console.error("[webhooks] failed to log delivery:", err));

  return { endpointId: endpoint.id, status, statusCode };
}

/**
 * Delivers `type` to every active endpoint of `userId` subscribed to it.
 * Respects the user's notification window. Resolves once all attempts finish.
 */
export async function deliverWebhookEvent(
  userId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
  options: {
    ignoreNotificationWindow?: boolean;
    eventId?: string;
    /** Deliver to this endpoint only (used by "send test"), even if paused. */
    onlyEndpointId?: string;
  } = {},
): Promise<DeliveryResult[]> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: options.onlyEndpointId
      ? { id: options.onlyEndpointId, userId }
      : { userId, isActive: true, eventTypes: { has: type } },
  });
  if (endpoints.length === 0) return [];

  const envelope: WebhookEnvelope = {
    id: options.eventId ?? `evt_${randomUUID()}`,
    type,
    timestamp: new Date().toISOString(),
    data,
  };

  if (!options.ignoreNotificationWindow) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        notificationStart: true,
        notificationEnd: true,
        timezone: true,
      },
    });
    if (
      user &&
      !isWithinNotificationWindow(
        new Date(),
        user.notificationStart,
        user.notificationEnd,
        user.timezone,
      )
    ) {
      await prisma.webhookDeliveryLog.createMany({
        data: endpoints.map((ep) => ({
          endpointId: ep.id,
          eventType: type,
          payload: envelope as any,
          status: "SKIPPED_OUTSIDE_WINDOW",
          statusCode: null,
        })),
      });
      return endpoints.map((ep) => ({
        endpointId: ep.id,
        status: "SKIPPED_OUTSIDE_WINDOW" as const,
        statusCode: null,
      }));
    }
  }

  return Promise.all(endpoints.map((ep) => deliverToEndpoint(ep, envelope)));
}

/**
 * Fire-and-forget variant for request handlers: runs after the response is
 * sent so user-facing latency is unaffected by slow receivers.
 */
export function emitWebhookEvent(
  userId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
): void {
  const run = () =>
    deliverWebhookEvent(userId, type, data).catch((err) =>
      console.error(`[webhooks] emit ${type} failed:`, err),
    );
  try {
    after(run);
  } catch {
    // Outside a request scope (scripts, tests) — run immediately.
    void run();
  }
}
