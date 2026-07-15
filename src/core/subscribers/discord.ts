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
    console.error(
      "[BookingConfirmedEvent] Error sending Discord notification:",
      error,
    );
  }
});

eventBus.on("session:rsvp", async (payload) => {
  const { sessionId, userId, status } = payload;

  try {
    const session = await prisma.coworkingSession.findUnique({
      where: { id: sessionId },
      include: {
        host: true,
        venue: true,
        _count: {
          select: {
            rsvps: {
              where: { status: "GOING" },
            },
          },
        },
      },
    });

    if (!session) return;

    const hostWebhookUrl = session.host?.discordWebhookUrl;
    if (!hostWebhookUrl) return;

    // Get the user who RSVP'd
    const rsvpedUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    const userName = rsvpedUser
      ? `${rsvpedUser.firstName || ""} ${rsvpedUser.lastName || ""}`.trim() ||
        rsvpedUser.email ||
        userId
      : userId;

    const embed = buildVenueEventEmbed({
      title: `Session RSVP Update: ${session.title}`,
      venueName: session.venue.name,
      address: session.venue.address,
      latitude: session.venue.latitude,
      longitude: session.venue.longitude,
    });

    // Customise description and fields for the RSVP
    embed.description = `👤 **${userName}** updated their RSVP status to **${status}** for the session at **${session.venue.name}**.`;

    // Add session times and participant count fields
    if (embed.fields) {
      embed.fields.push({
        name: "Session Time",
        value: `${new Date(session.startsAt).toLocaleString()} - ${new Date(session.endsAt).toLocaleString()}`,
        inline: false,
      });
      embed.fields.push({
        name: "Current Going Participants",
        value: `${session._count.rsvps}${session.maxGuests ? ` / ${session.maxGuests}` : ""}`,
        inline: true,
      });
    }

    await sendDiscordEmbedDebounced(hostWebhookUrl, embed);
  } catch (error) {
    console.error(
      "[SessionRsvpEvent] Error sending Discord notification:",
      error,
    );
  }
});
