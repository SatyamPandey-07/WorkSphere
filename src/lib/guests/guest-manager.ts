/**
 * Guest Manager
 *
 * Core business logic for the guest invitation system.
 * Orchestrates ICS generation, map provider lookup, email sending,
 * and database persistence.
 *
 * This module is framework-agnostic and can be used from:
 * - API routes (Next.js App Router)
 * - Event subscribers (booking:confirmed)
 * - Background workers / cron jobs
 */

import { prisma as prismaClient } from "@/lib/prisma";

// Cast for dynamic Prisma client access with the new BookingGuest model
const prisma = prismaClient as any;
import { buildIcsEventData, generateIcsContent } from "./ics-generator";
import { getVenueDirectionsLink } from "./map-provider";
import { sendGuestInvite } from "./email-service";
import type { GuestInfo, InviteResult } from "./types";

// =============================================================================
// Database Operations
// =============================================================================

/**
 * Create BookingGuest records in the database.
 * Uses raw SQL via Prisma $executeRaw since the BookingGuest model
 * has been added to the schema. Falls back to creating records directly.
 */
async function createGuestRecords(
  bookingId: string,
  guests: GuestInfo[],
): Promise<Array<{ id: string; email: string; name?: string | null }>> {
  const records = await Promise.all(
    guests.map((guest) =>
      prisma.bookingGuest.create({
        data: {
          bookingId,
          email: guest.email,
          name: guest.name || null,
          phone: guest.phone || null,
          status: "PENDING",
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      }),
    ),
  );
  return records;
}

/**
 * Update the status of a guest record.
 */
async function updateGuestStatus(
  guestId: string,
  status: "SENT" | "FAILED" | "CANCELLED",
  calendarUid?: string,
): Promise<void> {
  await prisma.bookingGuest.update({
    where: { id: guestId },
    data: {
      status,
      calendarUid: calendarUid || null,
      sentAt: status === "SENT" ? new Date() : undefined,
    },
  });
}

// =============================================================================
// Business Logic
// =============================================================================

/**
 * Send an invitation to a single guest.
 *
 * @param params - All data needed to generate and send the invite
 * @returns Result of the invitation attempt
 */
export async function sendGuestInvitation(params: {
  guest: GuestInfo;
  guestId: string; // DB record ID for status tracking
  bookingId: string;
  confirmationId: string;
  venueName: string;
  venueAddress: string;
  venueLatitude: number;
  venueLongitude: number;
  venuePhotoUrl?: string;
  hostName: string;
  hostEmail: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes: number;
}): Promise<InviteResult> {
  try {
    // 1. Build ICS event data
    const icsData = buildIcsEventData({
      bookingId: params.bookingId,
      confirmationId: params.confirmationId,
      venueName: params.venueName,
      venueAddress: params.venueAddress,
      venueLatitude: params.venueLatitude,
      venueLongitude: params.venueLongitude,
      venuePhotoUrl: params.venuePhotoUrl,
      hostName: params.hostName,
      hostEmail: params.hostEmail,
      guestEmail: params.guest.email,
      guestName: params.guest.name,
      date: params.date,
      time: params.time,
      durationMinutes: params.durationMinutes,
    });

    // 2. Generate ICS content
    const icsContent = generateIcsContent(icsData);

    // 3. Get directions link from map provider
    const directionsLink = getVenueDirectionsLink({
      latitude: params.venueLatitude,
      longitude: params.venueLongitude,
      name: params.venueName,
    });

    // 4. Send the email with ICS attachment
    const emailResult = await sendGuestInvite({
      guestEmail: params.guest.email,
      guestName: params.guest.name,
      hostName: params.hostName,
      venueName: params.venueName,
      venueAddress: params.venueAddress,
      date: params.date,
      time: params.time,
      durationMinutes: params.durationMinutes,
      icsContent,
      directionsUrl: directionsLink.url,
      venuePhotoUrl: params.venuePhotoUrl,
      bookingRef: params.confirmationId,
    });

    // 5. Update database record
    if (emailResult.success) {
      await updateGuestStatus(params.guestId, "SENT", icsData.uid);
      return {
        email: params.guest.email,
        success: true,
        calendarUid: icsData.uid,
      };
    } else {
      await updateGuestStatus(params.guestId, "FAILED");
      return {
        email: params.guest.email,
        success: false,
        error: emailResult.error,
      };
    }
  } catch (error: any) {
    console.error(
      `[GuestManager] Failed to send invite to ${params.guest.email}:`,
      error,
    );
    try {
      await updateGuestStatus(params.guestId, "FAILED");
    } catch (dbError) {
      console.error("[GuestManager] Failed to update guest status:", dbError);
    }
    return {
      email: params.guest.email,
      success: false,
      error: error?.message || "Unknown error",
    };
  }
}

/**
 * Invite multiple guests to a booking.
 *
 * @param bookingId - The booking ID
 * @param guests - Array of guest info (emails, optional names)
 * @param getVenueAndHost - Function that returns venue + host + booking details.
 *                         Injected to avoid coupling to a specific DB query pattern.
 * @returns Array of invite results
 */
export async function inviteGuestsToBooking(
  bookingId: string,
  guests: GuestInfo[],
  getVenueAndHost: () => Promise<{
    venue: {
      name: string;
      address: string;
      latitude: number;
      longitude: number;
      photoUrl?: string;
    };
    host: {
      name: string;
      email: string;
    };
    booking: {
      confirmationId: string;
      date: string;
      time: string;
      durationMinutes: number;
    };
  }>,
): Promise<InviteResult[]> {
  // 1. Create guest records in DB
  const guestRecords = await createGuestRecords(bookingId, guests);

  // 2. Fetch venue + host details
  const details = await getVenueAndHost();

  // 3. Send invites to all guests concurrently (with concurrency limit of 5)
  const CONCURRENCY_LIMIT = 5;
  const results: InviteResult[] = [];

  for (let i = 0; i < guestRecords.length; i += CONCURRENCY_LIMIT) {
    const batch = guestRecords.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(
      batch.map((record) =>
        sendGuestInvitation({
          guest: {
            email: record.email,
            name: record.name || undefined,
          },
          guestId: record.id,
          bookingId,
          confirmationId: details.booking.confirmationId,
          venueName: details.venue.name,
          venueAddress: details.venue.address,
          venueLatitude: details.venue.latitude,
          venueLongitude: details.venue.longitude,
          venuePhotoUrl: details.venue.photoUrl,
          hostName: details.host.name,
          hostEmail: details.host.email,
          date: details.booking.date,
          time: details.booking.time,
          durationMinutes: details.booking.durationMinutes,
        }),
      ),
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Cancel all pending guest invitations for a booking.
 */
export async function cancelGuestInvitations(bookingId: string): Promise<void> {
  await prisma.bookingGuest.updateMany({
    where: {
      bookingId,
      status: { in: ["PENDING", "SENT"] },
    },
    data: {
      status: "CANCELLED",
    },
  });
}

/**
 * Get all guests for a booking.
 */
export async function getBookingGuests(bookingId: string) {
  return prisma.bookingGuest.findMany({
    where: { bookingId },
    orderBy: { createdAt: "asc" },
  });
}
