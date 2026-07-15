import { eventBus } from "../events";
import { prisma } from "@/lib/prisma";
import { buildTelegramVenueAlert, sendTelegramAlert } from "@/lib/telegram";

eventBus.on("booking:confirmed", async (payload) => {
  const { bookingId, venue } = payload;

  try {
    const dbBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, venue: true },
    });

    const telegramWebhookUrl = dbBooking?.user?.telegramWebhookUrl;
    if (!telegramWebhookUrl) return;

    const userName = dbBooking?.user
      ? `${dbBooking.user.firstName || ""} ${dbBooking.user.lastName || ""}`.trim() || "Someone"
      : "Someone";

    const { text, inlineKeyboard } = buildTelegramVenueAlert({
      event: "booking",
      userName,
      venueName: venue.name,
      address: venue.address,
      latitude: dbBooking?.venue?.latitude,
      longitude: dbBooking?.venue?.longitude,
    });

    await sendTelegramAlert(telegramWebhookUrl, text, inlineKeyboard);
  } catch (error) {
    console.error("[BookingConfirmedEvent] Error sending Telegram notification:", error);
  }
});

eventBus.on("checkin:confirmed", async (payload) => {
  const { userId, userName, venue } = payload;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramWebhookUrl: true },
    });

    const telegramWebhookUrl = user?.telegramWebhookUrl;
    if (!telegramWebhookUrl) return;

    const { text, inlineKeyboard } = buildTelegramVenueAlert({
      event: "checkin",
      userName,
      venueName: venue.name,
      address: venue.address,
      latitude: venue.latitude,
      longitude: venue.longitude,
    });

    await sendTelegramAlert(telegramWebhookUrl, text, inlineKeyboard);
  } catch (error) {
    console.error("[CheckinConfirmedEvent] Error sending Telegram notification:", error);
  }
});
