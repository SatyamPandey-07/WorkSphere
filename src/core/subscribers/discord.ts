import { eventBus } from "../events";
import { prisma } from "@/lib/prisma";
import { buildVenueEventEmbed, sendDiscordEmbedDebounced } from "@/lib/discord";

eventBus.on("booking:confirmed", async (payload) => {
  const { bookingId, venue } = payload;

  try {
    const dbBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, venue: true },
    });

    const discordWebhookUrl = dbBooking?.user?.discordWebhookUrl;
    if (!discordWebhookUrl) return;

    const embed = buildVenueEventEmbed({
      title: `New booking: ${venue.name}`,
      venueName: venue.name,
      address: venue.address,
      latitude: dbBooking?.venue?.latitude,
      longitude: dbBooking?.venue?.longitude,
    });

    await sendDiscordEmbedDebounced(discordWebhookUrl, embed);
  } catch (error) {
    console.error("[BookingConfirmedEvent] Error sending Discord notification:", error);
  }
});