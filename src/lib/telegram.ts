export function isValidTelegramWebhookUrl(url: string): boolean {
  try {
    const trimmed = url.trim();
    const u = new URL(trimmed);
    if (u.protocol !== "https:" || u.hostname !== "api.telegram.org") return false;
    const pathParts = u.pathname.split("/");
    if (pathParts.length !== 3) return false; // ['', 'bot<token>', 'sendMessage']
    if (!pathParts[1].startsWith("bot")) return false;
    if (pathParts[2] !== "sendMessage") return false;
    const chatId = u.searchParams.get("chat_id");
    return !!chatId;
  } catch {
    return false;
  }
}

export async function sendTelegramAlert(
  webhookUrl: string,
  message: string,
  inlineKeyboard?: Array<Array<{ text: string; url: string }>>
): Promise<void> {
  try {
    if (!isValidTelegramWebhookUrl(webhookUrl)) {
      console.warn("[Telegram] Skipping dispatch: invalid webhook URL format");
      return;
    }

    const u = new URL(webhookUrl.trim());
    const chatId = u.searchParams.get("chat_id");
    u.searchParams.delete("chat_id");
    const postUrl = u.toString();

    const body: any = {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    };

    if (inlineKeyboard) {
      body.reply_markup = {
        inline_keyboard: inlineKeyboard,
      };
    }

    const response = await fetch(postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(
        `[Telegram] Webhook returned ${response.status}: ${await response.text()}`
      );
    }
  } catch (err) {
    console.error("[Telegram] Failed to dispatch webhook:", err);
  }
}

export function buildTelegramVenueAlert(params: {
  event: "booking" | "checkin";
  userName: string;
  venueName: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): { text: string; inlineKeyboard?: Array<Array<{ text: string; url: string }>> } {
  const { event, userName, venueName, address, latitude, longitude } = params;

  const actionText = event === "booking" ? "booked a spot at" : "checked in at";
  let text = `<b>${userName}</b> ${actionText} <b>${venueName}</b>!`;

  if (address) {
    text += `\n📍 <i>Address: ${address}</i>`;
  }

  if (latitude != null && longitude != null) {
    text += `\n🌐 <i>Coordinates: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}</i>`;
  }

  const inlineKeyboard =
    latitude != null && longitude != null
      ? [
          [
            {
              text: "Get Directions 🗺️",
              url: `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
            },
          ],
        ]
      : undefined;

  return { text, inlineKeyboard };
}
