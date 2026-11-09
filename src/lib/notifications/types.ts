import type { WebhookEventType } from "@prisma/client";

export type DeliveryStatus =
  | "SUCCESS"
  | "FAILED"
  | "BLOCKED"
  | "SKIPPED_OUTSIDE_WINDOW"
  | "CIRCUIT_OPEN";

export interface DeliveryResult {
  channel: string;
  status: DeliveryStatus;
  statusCode?: number | null;
  endpointId?: string;
  recipient?: string;
  error?: string;
  retryCount?: number;
  details?: Record<string, unknown>;
}

export interface NotificationMessage {
  id?: string;
  channel?: string;
  recipient?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  url?: string;
  type?: string | WebhookEventType;
  timestamp?: string | number;
  options?: Record<string, unknown>;
}

export interface NotificationChannel {
  readonly name: string;
  send(message: NotificationMessage): Promise<DeliveryResult>;
}

// ─── Webhook Specific Types ───────────────────────────────────────────────────

export interface WebhookEnvelope {
  id: string;
  type: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Discord Specific Types ───────────────────────────────────────────────────

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  image?: { url: string };
  timestamp?: string;
}

// ─── WhatsApp Specific Types ──────────────────────────────────────────────────

export interface WhatsAppNotificationPayload {
  to: string;
  venueName: string;
  address?: string | null;
  date: string;
  time: string;
  confirmationId: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface WhatsAppProvider {
  readonly name: string;
  send(payload: WhatsAppNotificationPayload): Promise<void>;
}

// ─── WebPush Specific Types ───────────────────────────────────────────────────

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
