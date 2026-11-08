/**
 * Compatibility bridge: Re-export WhatsApp notification utilities from consolidated @/lib/notifications module.
 */

export * from "@/lib/notifications";
import { whatsAppNotificationChannel } from "@/lib/notifications";

export const whatsAppService = {
  async sendBookingConfirmation(
    phoneNumber: string | null | undefined,
    _webhookUrl: string | null | undefined,
    payload: any,
  ) {
    if (!phoneNumber) return;
    try {
      await whatsAppNotificationChannel.send({
        channel: "whatsapp",
        recipient: phoneNumber,
        body: `Booking confirmed at ${payload?.venueName}`,
        data: { whatsappPayload: { ...payload, to: phoneNumber } },
      });
    } catch (err) {
      console.error("[WhatsApp] Failed to dispatch notification:", err);
    }
  },
};
