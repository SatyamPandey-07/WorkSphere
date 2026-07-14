import { eventBus } from "../events";
import { prisma } from "@/lib/prisma";
import { whatsAppService } from "@/lib/whatsapp";

// System-level webhook from env — fires for every booking (user preferences are out of scope)
const SYSTEM_WEBHOOK_URL = process.env.WHATSAPP_WEBHOOK_URL ?? null;

eventBus.on("booking:confirmed", async (payload) => {
  const { bookingId, confirmationId, venue, date, time } = payload;

  try {
    const dbVenue = await prisma.venue.findUnique({
      where: { id: venue.id },
      select: { address: true, latitude: true, longitude: true },
    });

    // customerPhone comes from the booking form; fall back to null if not provided
    const dbBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerPhone: true },
    });

    await whatsAppService.sendBookingConfirmation(
      dbBooking?.customerPhone ?? null,
      SYSTEM_WEBHOOK_URL,
      {
        to: dbBooking?.customerPhone ?? "",
        venueName: venue.name,
        address: dbVenue?.address,
        date,
        time,
        confirmationId,
        latitude: dbVenue?.latitude,
        longitude: dbVenue?.longitude,
      },
    );
  } catch (err) {
    console.error("[WhatsAppSubscriber] Unexpected error:", err);
  }
});
