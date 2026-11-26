import { createHmac, randomUUID } from "crypto";
import { Webhook } from "svix";
import { after } from "next/server";
import type { WebhookEndpoint, WebhookEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSafeWebhookUrl } from "@/lib/ssrfValidation";
import { isWithinNotificationWindow } from "@/lib/notificationWindow";
import { defaultNotificationHttpClient, SsrfBlockedError } from "../httpClient";
import type {
  NotificationChannel,
  NotificationMessage,
  DeliveryResult,
  WebhookEnvelope,
} from "../types";

const MAX_WEBHOOK_REDIRECTS = 20;

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 ||
    status === 307 || status === 308;
}

function redirectBlockReason(reason?: string): string {
  if (/private network|forbidden/i.test(reason || "")) {
    return "redirect_target_resolved_to_private_or_prohibited_ip";
  }
  if (/resolve/i.test(reason || "")) {
    return "redirect_target_dns_revalidation_failed";
  }
  if (/protocol/i.test(reason || "")) {
    return "redirect_target_uses_prohibited_protocol";
  }
  return "redirect_target_failed_ssrf_revalidation";
}

function logWebhookTelemetry(
  level: "info" | "warn",
  event: Record<string, string | number>,
): void {
  try {
    console[level](JSON.stringify(event));
  } catch {
    // Telemetry must not affect delivery or SSRF enforcement.
  }
}

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
  let redirectHopCount = 0;

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

      let currentUrl = endpoint.url;
      let requestInit: RequestInit = {
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
        redirect: "manual",
      };

      while (true) {
        const res = await defaultNotificationHttpClient.fetch(
          currentUrl,
          requestInit,
          { timeoutMs: 5000, maxRetries: 2 },
        );
        statusCode = res.status;

        const location = isRedirectStatus(res.status)
          ? res.headers.get("location")
          : null;
        if (!location) {
          status = res.ok ? "SUCCESS" : "FAILED";
          break;
        }

        redirectHopCount++;
        if (redirectHopCount > MAX_WEBHOOK_REDIRECTS) {
          status = "FAILED";
          break;
        }

        let redirectUrl: string;
        try {
          redirectUrl = new URL(location, currentUrl).toString();
        } catch {
          status = "BLOCKED";
          logWebhookTelemetry("warn", {
            event: "webhook.ssrf_redirect_blocked",
            endpointId: endpoint.id,
            redirectHopCount,
            blockReason: "redirect_target_invalid",
          });
          break;
        }

        const redirectSafety = await isSafeWebhookUrl(redirectUrl);
        if (!redirectSafety.isSafe) {
          status = "BLOCKED";
          logWebhookTelemetry("warn", {
            event: "webhook.ssrf_redirect_blocked",
            endpointId: endpoint.id,
            redirectHopCount,
            blockReason: redirectBlockReason(redirectSafety.reason),
          });
          break;
        }

        const previousUrl = new URL(currentUrl);
        const nextUrl = new URL(redirectUrl);
        if (previousUrl.origin !== nextUrl.origin) {
          const headers = new Headers(requestInit.headers);
          headers.delete("authorization");
          headers.delete("cookie");
          headers.delete("proxy-authorization");
          requestInit = { ...requestInit, headers };
        }

        if (
          res.status === 303 ||
          ((res.status === 301 || res.status === 302) &&
            requestInit.method === "POST")
        ) {
          const headers = new Headers(requestInit.headers);
          headers.delete("content-length");
          headers.delete("content-type");
          requestInit = {
            ...requestInit,
            method: "GET",
            headers,
            body: undefined,
          };
        }

        currentUrl = redirectUrl;
      }
    } catch {
      status = defaultNotificationHttpClient.isCircuitOpen(endpoint.url)
        ? "CIRCUIT_OPEN"
        : "FAILED";
    }
  }

  logWebhookTelemetry("info", {
    event: "webhook.delivery_redirect_telemetry",
    endpointId: endpoint.id,
    redirectHopCount,
    status,
  });

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
    details: { redirectHopCount },
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
    excludeEndpointIds?: string[];
  } = {},
): Promise<DeliveryResult[]> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: options.onlyEndpointId
      ? { id: options.onlyEndpointId, userId }
      : {
          userId,
          isActive: true,
          eventTypes: { has: type },
          ...(options.excludeEndpointIds?.length
            ? { id: { notIn: options.excludeEndpointIds } }
            : {}),
        },
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
      type: (message.type as WebhookEventType) || "VENUE_CREATED",
      timestamp:
        typeof message.timestamp === "string"
          ? message.timestamp
          : new Date().toISOString(),
      data: message.data || {},
    };

    if (message.url) {
      const pseudoEndpoint: WebhookEndpoint = {
        id: message.recipient || "direct-endpoint",
        url: message.url,
        secret: (message.options?.secret as string) || "whsec_insecuredefault",
        isActive: true,
        eventTypes: [envelope.type],
        headers: (message.options?.headers as any) || null,
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
