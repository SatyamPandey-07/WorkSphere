/**
 * Provider-agnostic WhatsApp notification service.
 *
 * Supports two delivery paths:
 *   1. Direct API  — sends to a phone number via a configured provider
 *   2. Webhook URL — POSTs structured JSON to a user-supplied HTTPS URL
 *                    (e.g. a Make/Zapier scenario that forwards to a WhatsApp group)
 *
 * Adding a new direct provider:
 *   1. Implement the `WhatsAppProvider` interface.
 *   2. Instantiate it in `resolveProvider()` based on env vars.
 *
 * Active direct provider is selected from environment variables:
 *   - Meta Cloud API → WHATSAPP_API_TOKEN + WHATSAPP_PHONE_NUMBER_ID
 *   - Twilio         → TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM
 */

import dns from "dns";
import https from "https";
import { isIP } from "net";

// ---------------------------------------------------------------------------
// Shared payload
// ---------------------------------------------------------------------------

export interface WhatsAppNotificationPayload {
  /** E.164 recipient phone number, e.g. "+14155552671" */
  to: string;
  venueName: string;
  address?: string | null;
  date: string;
  time: string;
  confirmationId: string;
  latitude?: number | null;
  longitude?: number | null;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface WhatsAppProvider {
  readonly name: string;
  send(payload: WhatsAppNotificationPayload): Promise<void>;
}

// ---------------------------------------------------------------------------
// Message formatter — shared across all delivery paths
// ---------------------------------------------------------------------------

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
      ``,
      `🗺️ *Location pin:* https://www.google.com/maps?q=${p.latitude},${p.longitude}`,
      `🧭 *Directions:* https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`,
    );
  }

  lines.push(``, `_Powered by WorkSphere_`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Meta WhatsApp Cloud API provider
// ---------------------------------------------------------------------------

export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "meta-cloud";

  constructor(
    private readonly apiToken: string,
    private readonly phoneNumberId: string,
  ) {}

  async send(payload: WhatsAppNotificationPayload): Promise<void> {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: payload.to.replace(/\D/g, ""),
          type: "text",
          text: { body: formatBookingMessage(payload) },
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`Meta Cloud API ${res.status}: ${await res.text()}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Twilio provider
// ---------------------------------------------------------------------------

export class TwilioProvider implements WhatsAppProvider {
  readonly name = "twilio";

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    /** e.g. "whatsapp:+14155238886" */
    private readonly from: string,
  ) {}

  async send(payload: WhatsAppNotificationPayload): Promise<void> {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${this.accountSid}:${this.authToken}`,
          ).toString("base64")}`,
        },
        body: new URLSearchParams({
          From: this.from,
          To: `whatsapp:${payload.to}`,
          Body: formatBookingMessage(payload),
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`Twilio API ${res.status}: ${await res.text()}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider resolver
// ---------------------------------------------------------------------------

function resolveProvider(): WhatsAppProvider | null {
  const metaToken = process.env.WHATSAPP_API_TOKEN;
  const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (metaToken && metaPhoneId) {
    return new MetaCloudProvider(metaToken, metaPhoneId);
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM;
  if (twilioSid && twilioToken && twilioFrom) {
    return new TwilioProvider(twilioSid, twilioToken, twilioFrom);
  }

  return null;
}

// Private/internal IP ranges that must never be fetched (SSRF prevention)
const BLOCKED_HOSTNAMES = /^(localhost|.*\.local)$/i;
const BLOCKED_IP =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|::1|fc00:|fe80:)/;

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    const first = parts[0];
    const second = parts[1];

    if (first === 127) return true;
    if (first === 10) return true;
    if (first === 169 && second === 254) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
    if (first === 0) return true;

    return false;
  }

  if (isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    ) {
      return true;
    }
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

    return false;
  }

  return true;
}

export async function isValidWebhookUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    if (BLOCKED_HOSTNAMES.test(parsed.hostname)) return false;
    if (BLOCKED_IP.test(parsed.hostname)) return false;

    const { address } = await dns.promises.lookup(parsed.hostname);
    if (isPrivateIp(address)) return false;

    return true;
  } catch {
    return false;
  }
}

/** Strip newlines from a value before logging to prevent log injection */
function sanitizeLog(value: string): string {
  return value.replace(/[\r\n]/g, " ");
}

// ---------------------------------------------------------------------------
// Notification service — single public entry point
// ---------------------------------------------------------------------------

export class WhatsAppNotificationService {
  private readonly provider: WhatsAppProvider | null;

  constructor() {
    this.provider = resolveProvider();
  }

  /**
   * Send a booking confirmation.
   *
   * @param phoneNumber  User's E.164 phone number — used with the direct provider.
   * @param webhookUrl   User-supplied HTTPS webhook URL — used for group-chat forwarding.
   * @param payload      Booking details to include in the message.
   *
   * Both paths are attempted independently; a failure in one does not block the other.
   */
  async sendBookingConfirmation(
    phoneNumber: string | null | undefined,
    webhookUrl: string | null | undefined,
    payload: WhatsAppNotificationPayload,
  ): Promise<void> {
    await Promise.allSettled([
      this._sendDirect(phoneNumber, payload),
      this._sendWebhook(webhookUrl, payload),
    ]);
  }

  private async _sendDirect(
    phoneNumber: string | null | undefined,
    payload: WhatsAppNotificationPayload,
  ): Promise<void> {
    if (!phoneNumber) return;

    if (!this.provider) {
      console.warn(
        "[WhatsApp] No direct provider configured. " +
          "Set WHATSAPP_API_TOKEN + WHATSAPP_PHONE_NUMBER_ID (Meta) " +
          "or TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM (Twilio).",
      );
      return;
    }

    try {
      await this.provider.send({ ...payload, to: phoneNumber });
      console.log(
        `[WhatsApp] Sent via ${this.provider.name} to ${sanitizeLog(phoneNumber)}`,
      );
    } catch (err) {
      console.error(
        `[WhatsApp] Direct send failed (${this.provider.name}):`,
        err,
      );
    }
  }

  private async _sendWebhook(
    webhookUrl: string | null | undefined,
    payload: WhatsAppNotificationPayload,
  ): Promise<void> {
    if (!webhookUrl || !(await isValidWebhookUrl(webhookUrl))) return;

    try {
      const parsed = new URL(webhookUrl);
      const { address } = await dns.promises.lookup(parsed.hostname);
      if (isPrivateIp(address)) {
        console.error(`[WhatsApp] Webhook blocked: Resolved to private IP ${address}`);
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const bodyData = JSON.stringify({
          ...payload,
          message: formatBookingMessage(payload),
        });

        const req = https.request(
          {
            hostname: address,
            port: parsed.port || 443,
            path: parsed.pathname + parsed.search,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Host": parsed.hostname,
            },
            servername: parsed.hostname,
            timeout: 5000,
          },
          (res) => {
            let resBody = "";
            res.on("data", (chunk) => {
              resBody += chunk;
            });
            res.on("end", () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                console.log(`[WhatsApp] Webhook delivered to ${sanitizeLog(webhookUrl)}`);
                resolve();
              } else {
                reject(new Error(`Webhook returned status ${res.statusCode}: ${resBody}`));
              }
            });
          }
        );

        req.on("timeout", () => {
          req.destroy(new Error("Request timeout"));
        });

        req.on("error", (err) => {
          reject(err);
        });

        req.write(bodyData);
        req.end();
      });
    } catch (err) {
      console.error("[WhatsApp] Webhook delivery failed:", err);
    }
  }
}

export const whatsAppService = new WhatsAppNotificationService();
