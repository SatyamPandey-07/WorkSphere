/**
 * Venue Seat Waitlist Service
 *
 * Manages user waitlist queues for fully booked venue seats,
 * monitors seat cancellations/checkouts, and automatically dispatches
 * availability notifications with time-limited exclusive claim windows.
 */

import { prisma } from "@/lib/prisma";
import {
  isValidBookingDate,
  isValidTimeZone,
  normalizeBookingTime,
  conflictDateWindow,
  findConflictingBookings,
} from "@/lib/booking";
import { NotificationDispatcher } from "@/lib/notifications/dispatcher";
import type {
  JoinWaitlistInput,
  WaitlistEntry,
  ClaimWaitlistSeatResult,
} from "./types";

const CLAIM_WINDOW_MINUTES = 15; // User has 15 minutes to claim an offered seat

const dispatcher = new NotificationDispatcher();

/**
 * Places a user on the waitlist for a venue's seats at a given date/time.
 */
export async function joinVenueWaitlist(
  userId: string,
  input: JoinWaitlistInput,
): Promise<{ success: boolean; entry: WaitlistEntry; message?: string }> {
  const {
    venueId,
    date,
    time: rawTime,
    duration = 60,
    timeZone: rawTimeZone,
    seatId,
    seatType,
    requiresQuiet = false,
    requiresOutlets = false,
  } = input;

  const time = normalizeBookingTime(rawTime);
  if (!isValidBookingDate(date) || !time || duration <= 0 || duration > 480) {
    throw new Error("Invalid date, time, or duration parameters.");
  }

  const timeZone = isValidTimeZone(rawTimeZone) ? (rawTimeZone as string) : "UTC";

  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { id: true, name: true },
  });

  if (!venue) {
    throw new Error("Venue not found.");
  }

  // Check if user already has an active waitlist entry for this venue and time slot
  const existing = await prisma.venueSeatWaitlist.findFirst({
    where: {
      userId,
      venueId,
      date,
      time,
      status: { in: ["ACTIVE", "NOTIFIED"] },
    },
    include: {
      venue: { select: { name: true } },
      seat: { select: { seatNumber: true } },
    },
  });

  if (existing) {
    const queuePosition = await calculateQueuePosition(
      existing.venueId,
      existing.date,
      existing.time,
      existing.createdAt,
    );
    const totalInQueue = await countActiveInQueue(
      existing.venueId,
      existing.date,
      existing.time,
    );

    return {
      success: true,
      entry: formatWaitlistRecord(existing, queuePosition, totalInQueue),
      message: "You are already on the waitlist for this time slot.",
    };
  }

  // Create new waitlist entry
  const created = await prisma.venueSeatWaitlist.create({
    data: {
      userId,
      venueId,
      seatId: seatId || null,
      seatType: (seatType as any) || null,
      date,
      time,
      duration,
      timeZone,
      requiresQuiet,
      requiresOutlets,
      status: "ACTIVE",
    },
    include: {
      venue: { select: { name: true } },
      seat: { select: { seatNumber: true } },
    },
  });

  const queuePosition = await calculateQueuePosition(
    created.venueId,
    created.date,
    created.time,
    created.createdAt,
  );
  const totalInQueue = await countActiveInQueue(
    created.venueId,
    created.date,
    created.time,
  );

  return {
    success: true,
    entry: formatWaitlistRecord(created, queuePosition, totalInQueue),
    message: `Successfully joined waitlist! You are #${queuePosition} in line.`,
  };
}

/**
 * Retrieves the current waitlist entries for a specific user.
 */
export async function getUserWaitlistEntries(
  userId: string,
  venueId?: string,
): Promise<WaitlistEntry[]> {
  const whereClause: any = {
    userId,
    status: { in: ["ACTIVE", "NOTIFIED"] },
  };

  if (venueId) {
    whereClause.venueId = venueId;
  }

  const entries = await prisma.venueSeatWaitlist.findMany({
    where: whereClause,
    include: {
      venue: { select: { name: true } },
      seat: { select: { seatNumber: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(
    entries.map(async (entry) => {
      const queuePosition = await calculateQueuePosition(
        entry.venueId,
        entry.date,
        entry.time,
        entry.createdAt,
      );
      const totalInQueue = await countActiveInQueue(
        entry.venueId,
        entry.date,
        entry.time,
      );
      return formatWaitlistRecord(entry, queuePosition, totalInQueue);
    }),
  );
}

/**
 * Cancels a user's active waitlist entry.
 */
export async function cancelWaitlistEntry(
  waitlistId: string,
  userId: string,
): Promise<boolean> {
  const entry = await prisma.venueSeatWaitlist.findFirst({
    where: { id: waitlistId, userId },
  });

  if (!entry) return false;

  await prisma.venueSeatWaitlist.update({
    where: { id: waitlistId },
    data: { status: "CANCELLED" },
  });

  return true;
}

/**
 * Checks and notifies the next eligible user in the waitlist when a seat becomes free.
 */
export async function notifyNextInWaitlist(
  venueId: string,
  date: string,
  time: string,
  _freedDuration: number = 60,
  freedSeatId?: string | null,
): Promise<{ notified: boolean; waitlistId?: string; userId?: string }> {
  // First expire any stale notified entries whose claim window lapsed
  await expireStaleWaitlistOffers();

  // Find eligible candidate in FIFO order
  const candidates = await prisma.venueSeatWaitlist.findMany({
    where: {
      venueId,
      date: { in: conflictDateWindow(date) },
      status: "ACTIVE",
    },
    include: {
      venue: { select: { name: true } },
      user: { select: { email: true, firstName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (candidates.length === 0) {
    return { notified: false };
  }

  // Filter candidates matching seat preferences if freedSeatId is provided
  let candidate = candidates[0];
  if (freedSeatId) {
    const seat = await prisma.venueSeat.findUnique({
      where: { id: freedSeatId },
    });
    if (seat) {
      const match = candidates.find((c) => {
        if (c.seatId && c.seatId !== freedSeatId) return false;
        if (c.seatType && c.seatType !== seat.type) return false;
        if (c.requiresQuiet && !seat.isQuietZone) return false;
        if (c.requiresOutlets && !seat.amenities.includes("outlets")) return false;
        return true;
      });
      if (match) {
        candidate = match;
      }
    }
  }

  const claimExpiresAt = new Date(Date.now() + CLAIM_WINDOW_MINUTES * 60 * 1000);

  // Transition candidate to NOTIFIED status with expiration window
  await prisma.venueSeatWaitlist.update({
    where: { id: candidate.id },
    data: {
      status: "NOTIFIED",
      notifiedAt: new Date(),
      claimExpiresAt,
      seatId: freedSeatId || candidate.seatId,
    },
  });

  // Dispatch WebPush / Push Notification
  try {
    await dispatcher.dispatch("webpush", {
      recipient: candidate.userId,
      title: "Workspace Seat Available!",
      body: `A seat opened up at ${candidate.venue.name} for ${candidate.date} at ${candidate.time}. You have ${CLAIM_WINDOW_MINUTES} minutes to claim your reservation.`,
      url: `/venues/${venueId}?claimWaitlist=${candidate.id}`,
      data: {
        type: "WAITLIST_SEAT_AVAILABLE",
        waitlistId: candidate.id,
        venueId,
        expiresAt: claimExpiresAt.toISOString(),
      },
      options: {
        isCritical: true,
      },
    });
  } catch (err) {
    console.error("Failed to send waitlist notification:", err);
  }

  return {
    notified: true,
    waitlistId: candidate.id,
    userId: candidate.userId,
  };
}

/**
 * Claims an offered seat from the waitlist, converting it into a confirmed Booking.
 */
export async function claimWaitlistSeat(
  waitlistId: string,
  userId: string,
): Promise<ClaimWaitlistSeatResult> {
  const entry = await prisma.venueSeatWaitlist.findFirst({
    where: {
      id: waitlistId,
      userId,
    },
    include: {
      venue: true,
      user: true,
      seat: true,
    },
  });

  if (!entry) {
    return { success: false, waitlistId, error: "Waitlist entry not found." };
  }

  if (entry.status !== "NOTIFIED") {
    return {
      success: false,
      waitlistId,
      error: `Entry is in ${entry.status} status and cannot be claimed.`,
    };
  }

  if (entry.claimExpiresAt && entry.claimExpiresAt < new Date()) {
    await prisma.venueSeatWaitlist.update({
      where: { id: waitlistId },
      data: { status: "EXPIRED" },
    });
    // Immediately offer to next person in line
    notifyNextInWaitlist(entry.venueId, entry.date, entry.time, entry.duration);
    return {
      success: false,
      waitlistId,
      error: "Your claim window has expired.",
    };
  }

  // Find an available seat if not already assigned
  let targetSeatId = entry.seatId;
  let targetSeatNumber: string | undefined = entry.seat?.seatNumber;

  if (!targetSeatId) {
    const availableSeat = await prisma.venueSeat.findFirst({
      where: {
        venueId: entry.venueId,
        isEnabled: true,
        ...(entry.requiresQuiet ? { isQuietZone: true } : {}),
      },
    });
    if (availableSeat) {
      targetSeatId = availableSeat.id;
      targetSeatNumber = availableSeat.seatNumber;
    }
  }

  const confirmationId = `WS-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  // Create confirmed booking
  const booking = await prisma.booking.create({
    data: {
      userId,
      venueId: entry.venueId,
      date: entry.date,
      time: entry.time,
      duration: entry.duration,
      timeZone: entry.timeZone || "UTC",
      customerEmail: entry.user.email || "waitlist@worksphere.app",
      status: "CONFIRMED",
      confirmationId,
      seatId: targetSeatId,
      seatNumber: targetSeatNumber,
    },
  });

  // Mark waitlist as CLAIMED
  await prisma.venueSeatWaitlist.update({
    where: { id: waitlistId },
    data: {
      status: "CLAIMED",
      claimedAt: new Date(),
    },
  });

  return {
    success: true,
    waitlistId,
    bookingId: booking.id,
    confirmationId: booking.confirmationId,
    seatId: targetSeatId || undefined,
    seatNumber: targetSeatNumber,
  };
}

/**
 * Maintenance routine to expire stale offers and notify following waiters.
 */
export async function expireStaleWaitlistOffers(): Promise<number> {
  const expiredEntries = await prisma.venueSeatWaitlist.findMany({
    where: {
      status: "NOTIFIED",
      claimExpiresAt: { lt: new Date() },
    },
  });

  for (const entry of expiredEntries) {
    await prisma.venueSeatWaitlist.update({
      where: { id: entry.id },
      data: { status: "EXPIRED" },
    });
    // Trigger notification for the next person in line
    notifyNextInWaitlist(entry.venueId, entry.date, entry.time, entry.duration, entry.seatId);
  }

  return expiredEntries.length;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function calculateQueuePosition(
  venueId: string,
  date: string,
  time: string,
  createdAt: Date,
): Promise<number> {
  const countBefore = await prisma.venueSeatWaitlist.count({
    where: {
      venueId,
      date,
      time,
      status: { in: ["ACTIVE", "NOTIFIED"] },
      createdAt: { lt: createdAt },
    },
  });
  return countBefore + 1;
}

async function countActiveInQueue(
  venueId: string,
  date: string,
  time: string,
): Promise<number> {
  return prisma.venueSeatWaitlist.count({
    where: {
      venueId,
      date,
      time,
      status: { in: ["ACTIVE", "NOTIFIED"] },
    },
  });
}

function formatWaitlistRecord(
  raw: any,
  queuePosition: number,
  totalInQueue: number,
): WaitlistEntry {
  return {
    id: raw.id,
    userId: raw.userId,
    venueId: raw.venueId,
    venueName: raw.venue?.name,
    seatId: raw.seatId,
    seatNumber: raw.seat?.seatNumber,
    seatType: raw.seatType,
    date: raw.date,
    time: raw.time,
    duration: raw.duration,
    timeZone: raw.timeZone || "UTC",
    requiresQuiet: raw.requiresQuiet,
    requiresOutlets: raw.requiresOutlets,
    status: raw.status,
    queuePosition,
    totalInQueue,
    notifiedAt: raw.notifiedAt ? raw.notifiedAt.toISOString() : null,
    claimExpiresAt: raw.claimExpiresAt ? raw.claimExpiresAt.toISOString() : null,
    claimedAt: raw.claimedAt ? raw.claimedAt.toISOString() : null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  };
}
