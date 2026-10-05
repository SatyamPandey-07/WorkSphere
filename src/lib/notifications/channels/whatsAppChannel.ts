import { defaultNotificationHttpClient } from "../httpClient";
import type {
  NotificationChannel,
  NotificationMessage,
  DeliveryResult,
  WhatsAppNotificationPayload,
  WhatsAppProvider,
} from "../types";

export function formatBookingMessage(p: WhatsAppNotificationPayload): string {
  const lines: string[] = [
    `✅ *WorkSphere Booking Confirmed*`,
    ``,
    `📍 *Venue:* ${p.venueName}`,
  ];

  if (p.address) lines.push(`🏠 *Address:* ${p.address}`);

  lines.push(`📅 *Date:* ${p.date}  🕐 *Time:* ${p.time}`);
  lines.push(`🔖 *Ref:* ${p.confirmationId}`);

  if (p.latitude != null && p.longitude != null) {
    lines.push(
      `🗺️ *Directions:* https://maps.google.com/?q=${p.latitude},${p.longitude}`,
    );
  }

  lines.push(``);
  lines.push(`Need to make changes? Visit your WorkSphere dashboard.`);

  return lines.join("\n");
}

class MetaCloudApiProvider implements WhatsAppProvider {
  readonly name = "meta";

  constructor(
    private readonly apiToken: string,
    private readonly phoneNumberId: string,
  ) {}

  async send(payload: WhatsAppNotificationPayload): Promise<void> {
    const to = payload.to.replace(/\D/g, "");
    const body = formatBookingMessage(payload);

    const url = `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`;
    await defaultNotificationHttpClient.fetch(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: true, body },
        }),
      },
      { timeoutMs: 5000, maxRetries: 2 },
    );
  }
}

class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly name = "twilio";

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {}

  async send(payload: WhatsAppNotificationPayload): Promise<void> {
    const rawTo = payload.to.startsWith("+") ? payload.to : `+${payload.to}`;
    const to = `whatsapp:${rawTo}`;
    const from = this.fromNumber.startsWith("whatsapp:")
      ? this.fromNumber
      : `whatsapp:${this.fromNumber}`;

    const body = formatBookingMessage(payload);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const credentials = Buffer.from(
      `${this.accountSid}:${this.authToken}`,
    ).toString("base64");

    const params = new URLSearchParams({ From: from, To: to, Body: body });

    await defaultNotificationHttpClient.fetch(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
      { timeoutMs: 5000, maxRetries: 2 },
    );
  }
}

export function resolveProvider(): WhatsAppProvider | null {
  const metaToken = process.env.WHATSAPP_API_TOKEN;
  const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (metaToken && metaPhoneId) {
    return new MetaCloudApiProvider(metaToken, metaPhoneId);
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM;
  if (twilioSid && twilioToken && twilioFrom) {
    return new TwilioWhatsAppProvider(twilioSid, twilioToken, twilioFrom);
  }

  return null;
}

export class WhatsAppNotificationChannel implements NotificationChannel {
  public readonly name = "whatsapp";

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const payload = message.data as unknown as WhatsAppNotificationPayload;
    if (!payload || !payload.to) {
      return {
        channel: this.name,
        status: "FAILED",
        error: "Missing WhatsApp payload or recipient phone number",
      };
    }

    try {
      const provider = resolveProvider();
      if (!provider) {
        return {
          channel: this.name,
          status: "FAILED",
          error: "No WhatsApp provider configured (set Meta or Twilio env vars)",
        };
      }

      await provider.send(payload);
      return {
        channel: this.name,
        status: "SUCCESS",
        statusCode: 200,
        recipient: payload.to,
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

export const whatsAppNotificationChannel = new WhatsAppNotificationChannel();
