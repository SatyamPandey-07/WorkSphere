import { defaultNotificationHttpClient } from "../httpClient";
import type {
  NotificationChannel,
  NotificationMessage,
  DeliveryResult,
  DiscordEmbed,
} from "../types";

export function isValidDiscordWebhookUrl(url: string): boolean {
  return /^https:\/\/discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url.trim());
}

const lastSentAt = new Map<string, number>();
const COOLDOWN_MS = 3000;

export async function sendDiscordEmbed(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  try {
    if (!isValidDiscordWebhookUrl(webhookUrl)) {
      console.warn("[Discord] Skipping dispatch: invalid webhook URL format");
      return;
    }

    await defaultNotificationHttpClient.fetch(
      webhookUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              ...embed,
              color: embed.color ?? 0x5865f2,
              timestamp: embed.timestamp ?? new Date().toISOString(),
            },
          ],
        }),
      },
      { timeoutMs: 5000, maxRetries: 2 },
    );
  } catch (err) {
    console.error("[Discord] Failed to dispatch webhook:", err);
  }
}

export async function sendDiscordEmbedDebounced(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  const now = Date.now();
  const last = lastSentAt.get(webhookUrl) ?? 0;

  if (now - last < COOLDOWN_MS) {
    return;
  }

  lastSentAt.set(webhookUrl, now);
  await sendDiscordEmbed(webhookUrl, embed);
}

export class DiscordNotificationChannel implements NotificationChannel {
  public readonly name = "discord";

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const webhookUrl = message.url || message.recipient;
    if (!webhookUrl || !isValidDiscordWebhookUrl(webhookUrl)) {
      return {
        channel: this.name,
        status: "FAILED",
        error: "Invalid or missing Discord webhook URL",
      };
    }

    const embed: DiscordEmbed = (message.data?.embed as DiscordEmbed) || {
      title: message.title || "WorkSphere Notification",
      description: message.body,
      timestamp: new Date().toISOString(),
    };

    try {
      if (message.options?.debounced) {
        await sendDiscordEmbedDebounced(webhookUrl, embed);
      } else {
        await sendDiscordEmbed(webhookUrl, embed);
      }
      return {
        channel: this.name,
        status: "SUCCESS",
        statusCode: 200,
        recipient: webhookUrl,
      };
    } catch (err: any) {
      return {
        channel: this.name,
        status: "FAILED",
        error: err.message,
      };
    }
  }
}

export const discordNotificationChannel = new DiscordNotificationChannel();
