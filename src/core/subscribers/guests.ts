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
import { inviteGuestsToBooking } from "@/lib/guests";

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

    // Send invitations using the guest manager
    const results = await inviteGuestsToBooking(
      bookingId,
      guests.map((g) => ({ email: g.email, name: g.name || undefined })),
      async () => ({
        venue: {
          name: booking.venue!.name,
          address: booking.venue!.address || "",
          latitude: booking.venue!.latitude,
          longitude: booking.venue!.longitude,
          photoUrl: booking.venue!.imageUrl || undefined,
        },
        host: {
          name: hostName,
          email: booking!.customerEmail,
        },
        booking: {
          confirmationId: booking!.confirmationId,
          date: booking!.date,
          time: booking!.time,
          durationMinutes: booking!.duration || 60,
        },
      }),
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
