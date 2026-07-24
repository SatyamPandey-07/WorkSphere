/**
 * Guest Invitation Event Subscriber
 *
 * Listens to `booking:confirmed` events and automatically sends
 * ICS invitations to associated guests.
 *
 * This subscriber is imported in the booking confirmation route
 * (src/app/api/bookings/confirm/route.ts) to ensure it's registered
 * when bookings are made.
 *
 * For standalone use: import '@/core/subscribers/guests';
 */

import { eventBus } from "../events";
import { prisma as prismaClient } from "@/lib/prisma";
import { sendGuestInvitation } from "@/lib/guests";

// Cast for dynamic Prisma client access with the new BookingGuest model
const prisma = prismaClient as any;

// Type for guest records fetched from DB
interface GuestRecord {
  id: string;
  email: string;
  name: string | null;
  status: string;
}

eventBus.on("booking:confirmed", async (payload) => {
  const { bookingId } = payload;

  try {
    // Fetch existing guests for this booking
    const guests: GuestRecord[] = await prisma.bookingGuest.findMany({
      where: {
        bookingId,
        status: "PENDING",
      },
    });

    if (guests.length === 0) {
      return; // No guests to invite
    }

    // Fetch booking with venue and user details
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        venue: true,
        user: true,
      },
    });

    if (!booking || !booking.venue || !booking.user) {
      console.error(
        "[GuestSubscriber] Booking, venue, or user not found:",
        bookingId,
      );
      return;
    }

    const hostName =
      [booking.user.firstName, booking.user.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || booking.customerEmail;

    // Send invitations directly to existing guests in parallel
    const results = await Promise.all(
      guests.map((g) =>
        sendGuestInvitation({
          guest: {
            email: g.email,
            name: g.name || undefined,
          },
          guestId: g.id,
          bookingId,
          confirmationId: booking.confirmationId,
          venueName: booking.venue!.name,
          venueAddress: booking.venue!.address || "",
          venueLatitude: booking.venue!.latitude,
          venueLongitude: booking.venue!.longitude,
          venuePhotoUrl: booking.venue!.imageUrl || undefined,
          hostName,
          hostEmail: booking.customerEmail,
          date: booking.date,
          time: booking.time,
          durationMinutes: booking.duration || 60,
        }),
      ),
    );

    // Emit individual events for each result
    for (const result of results) {
      const guest = guests.find((g) => g.email === result.email);
      await eventBus.emit("booking:guest-invited", {
        bookingId,
        guestEmail: result.email,
        guestName: guest?.name || undefined,
        inviteResult: result.success ? "sent" : "failed",
        error: result.error,
      });
    }

    console.log(
      `[GuestSubscriber] Processed ${results.length} guest invitations for booking ${bookingId}`,
    );
  } catch (error) {
    console.error(
      "[GuestSubscriber] Error processing guest invitations:",
      error,
    );
  }
});
