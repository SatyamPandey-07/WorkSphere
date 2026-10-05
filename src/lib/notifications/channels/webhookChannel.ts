import { createHmac, randomUUID } from "crypto";
import { Webhook } from "svix";
import { after } from "next/server";
import type { WebhookEndpoint, WebhookEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSafeWebhookUrl } from "@/lib/ssrfValidation";
import { isWithinNotificationWindow } from "@/lib/notificationWindow";
import { defaultNotificationHttpClient } from "../httpClient";
import type {
  NotificationChannel,
  NotificationMessage,
  DeliveryResult,
  WebhookEnvelope,
} from "../types";

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

export function verifyWebhookPayload(
  payload: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  secret: string,
): unknown {
  if (!svixId || !svixTimestamp || !svixSignature) {
    return null;
  }

  const wh = new Webhook(secret);
  try {
    return wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return null;
  }
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

export async function deliverToEndpoint(
  endpoint: WebhookEndpoint,
  envelope: WebhookEnvelope,
): Promise<DeliveryResult> {
  const body = JSON.stringify(envelope);
  let status: DeliveryResult["status"] = "FAILED";
  let statusCode: number | null = null;

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

      const res = await defaultNotificationHttpClient.fetch(
        endpoint.url,
        {
          method: "POST",
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
        },
        { timeoutMs: 5000, maxRetries: 2 },
      );

      statusCode = res.status;
      status = res.ok ? "SUCCESS" : "FAILED";
    } catch {
      status = defaultNotificationHttpClient.isCircuitOpen(endpoint.url)
        ? "CIRCUIT_OPEN"
        : "FAILED";
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

  return {
    channel: "webhook",
    endpointId: endpoint.id,
    status,
    statusCode,
  };
}

export async function deliverWebhookEvent(
  userId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
  options: {
    ignoreNotificationWindow?: boolean;
    eventId?: string;
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
        channel: "webhook",
        endpointId: ep.id,
        status: "SKIPPED_OUTSIDE_WINDOW" as const,
        statusCode: null,
      }));
    }
  }

  return Promise.all(endpoints.map((ep) => deliverToEndpoint(ep, envelope)));
}

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
    void run();
  }
}

export class WebhookNotificationChannel implements NotificationChannel {
  public readonly name = "webhook";

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const envelope: WebhookEnvelope = {
      id: message.id || randomUUID(),
      type: (message.type as WebhookEventType) || "venue.created",
      timestamp: typeof message.timestamp === "string" ? message.timestamp : new Date().toISOString(),
      data: message.data || {},
    };

    if (message.url) {
      const pseudoEndpoint: WebhookEndpoint = {
        id: message.recipient || "direct-endpoint",
        url: message.url,
        secret: (message.options?.secret as string) || "whsec_insecuredefault",
        enabled: true,
        events: [envelope.type],
        headers: (message.options?.headers as any) || null,
        description: null,
        userId: "system",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return deliverToEndpoint(pseudoEndpoint, envelope);
    }

    return {
      channel: this.name,
      status: "FAILED",
      error: "No webhook URL or endpoint specified",
    };
  }
}

export const webhookNotificationChannel = new WebhookNotificationChannel();
