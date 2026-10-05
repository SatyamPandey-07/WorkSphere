import { defaultNotificationHttpClient } from "../httpClient";
import type {
  NotificationChannel,
  NotificationMessage,
  DeliveryResult,
} from "../types";

export function isValidTelegramWebhookUrl(url: string): boolean {
  try {
    const trimmed = url.trim();
    const u = new URL(trimmed);
    if (u.protocol !== "https:" || u.hostname !== "api.telegram.org") return false;
    const pathParts = u.pathname.split("/");
    if (pathParts.length !== 3) return false;
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
  inlineKeyboard?: Array<Array<{ text: string; url: string }>>,
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

    await defaultNotificationHttpClient.fetch(
      postUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { timeoutMs: 5000, maxRetries: 2 },
    );
  } catch (err) {
    console.error("[Telegram] Failed to dispatch webhook:", err);
  }
}

export class TelegramNotificationChannel implements NotificationChannel {
  public readonly name = "telegram";

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const webhookUrl = message.url || message.recipient;
    if (!webhookUrl || !isValidTelegramWebhookUrl(webhookUrl)) {
      return {
        channel: this.name,
        status: "FAILED",
        error: "Invalid or missing Telegram webhook URL",
      };
    }

    try {
      const text = message.body || message.title || "";
      const inlineKeyboard = message.data?.inlineKeyboard as any;
      await sendTelegramAlert(webhookUrl, text, inlineKeyboard);
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

export const telegramNotificationChannel = new TelegramNotificationChannel();
