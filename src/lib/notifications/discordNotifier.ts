import { isValidDiscordWebhookUrl } from "./channels/discordChannel";

const DISCORD_RED = 0xe11d48;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RATE_LIMIT_RETRIES = 2;

export interface VenueCancellationDiscordNotification {
  webhookUrl: string;
  bookingId: string;
  venueName: string;
  venueAddress: string | null;
  affectedTimeSlot: string;
  refundStatus: string;
  bookingDetailsUrl: string;
}

interface DiscordWebhookResponse {
  ok: boolean;
  status: number;
  headers: Headers;
}

function getRetryDelayMs(response: DiscordWebhookResponse): number {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return 1_000;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1_000));
  }

  const retryAt = Date.parse(retryAfter);
  return Number.isNaN(retryAt)
    ? 1_000
    : Math.max(0, retryAt - Date.now());
}

function buildDiscordPayload(
  notification: VenueCancellationDiscordNotification,
) {
  return {
    embeds: [
      {
        title: `⚠️ Venue Closure Notification - ${notification.venueName}`,
        color: DISCORD_RED,
        fields: [
          { name: "Booking ID", value: notification.bookingId, inline: true },
          {
            name: "Venue Address",
            value: notification.venueAddress || "Address unavailable",
            inline: false,
          },
          {
            name: "Affected Time Slot",
            value: notification.affectedTimeSlot,
            inline: true,
          },
          {
            name: "Refund Status",
            value: notification.refundStatus,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "View booking details",
            url: notification.bookingDetailsUrl,
          },
        ],
      },
    ],
  };
}

export async function dispatchVenueCancellationDiscordNotification(
  notification: VenueCancellationDiscordNotification,
): Promise<boolean> {
  if (!isValidDiscordWebhookUrl(notification.webhookUrl)) {
    console.warn(
      "[Discord] Skipping venue cancellation notification: invalid webhook URL",
    );
    return false;
  }

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const response = await fetch(notification.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDiscordPayload(notification)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return true;

      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, getRetryDelayMs(response)),
        );
        continue;
      }

      console.error(
        `[Discord] Venue cancellation notification failed with HTTP ${response.status}`,
      );
      return false;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error";
      console.error(
        `[Discord] Venue cancellation notification network failure: ${message}`,
      );
      return false;
    }
  }

  return false;
}
