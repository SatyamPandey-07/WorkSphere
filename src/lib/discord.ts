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

export function isValidDiscordWebhookUrl(url: string): boolean {
  return /^https:\/\/discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url.trim());
}

export async function sendDiscordEmbed(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  try {
    if (!isValidDiscordWebhookUrl(webhookUrl)) {
      console.warn("[Discord] Skipping dispatch: invalid webhook URL format");
      return;
    }

    const response = await fetch(webhookUrl, {
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
    });

    if (!response.ok) {
      console.error(`[Discord] Webhook returned ${response.status}: ${await response.text()}`);
    }
  } catch (err) {
    // Never let a Discord failure bubble up and break the caller's flow
    console.error("[Discord] Failed to dispatch webhook:", err);
  }
}

const lastSentAt = new Map<string, number>();
const COOLDOWN_MS = 3000; // 3s per webhook URL

export async function sendDiscordEmbedDebounced(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  const now = Date.now();
  const last = lastSentAt.get(webhookUrl) ?? 0;

  if (now - last < COOLDOWN_MS) {
    return; // silently skip -- avoids spamming on rapid-fire events
  }

  lastSentAt.set(webhookUrl, now);
  await sendDiscordEmbed(webhookUrl, embed);
}

export function buildVenueEventEmbed(params: {
  title: string;
  venueName: string;
  address?: string | null;
  imageUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): DiscordEmbed {
  const { title, venueName, address, imageUrl, latitude, longitude } = params;

  const fields: DiscordEmbedField[] = [];
  if (address) fields.push({ name: "Address", value: address, inline: false });
  if (latitude != null && longitude != null) {
    fields.push({
      name: "Coordinates",
      value: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      inline: true,
    });
    fields.push({
      name: "Directions",
      value: `[Open in Maps](https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude})`,
      inline: true,
    });
  }

  return {
    title,
    description: `📍 ${venueName}`,
    fields,
    image: imageUrl ? { url: imageUrl } : undefined,
  };
}