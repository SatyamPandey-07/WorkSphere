/**
 * Venue Seat Waitlist Service
 *
 * Manages user waitlist queues for fully booked venue seats,
 * monitors seat cancellations/checkouts, and automatically dispatches
 * availability notifications with time-limited exclusive claim windows.
 */

import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  isValidBookingDate,
  isValidTimeZone,
  normalizeBookingTime,
  conflictDateWindow,
  findConflictingBookings,
  bookingInterval,
  intervalsOverlap,
} from "@/lib/booking";
import { NotificationDispatcher } from "@/lib/notifications/dispatcher";
import type {
  JoinWaitlistInput,
  WaitlistEntry,
  ClaimWaitlistSeatResult,
} from "./types";

const CLAIM_WINDOW_MINUTES = 15; // User has 15 minutes to claim an offered seat
const CLAIM_MAX_RETRIES = 3; // Serializable transactions can abort; retry a few times

const dispatcher = new NotificationDispatcher();

type ClaimFailureCode =
  | "NOT_FOUND"
  | "NOT_CLAIMABLE"
  | "EXPIRED"
  | "SEAT_UNAVAILABLE";

/**
 * Domain error thrown inside the claim transaction. Throwing (rather than
 * returning) rolls the whole transaction back, so a failed claim can never
 * leave a half-written booking or a half-updated waitlist entry behind.
 */
class WaitlistClaimError extends Error {
  code: ClaimFailureCode;

  constructor(code: ClaimFailureCode, message: string) {
    super(message);
    this.name = "WaitlistClaimError";
    this.code = code;
  }
}

function isTransientTransactionError(err: any): boolean {
  return (
    err?.code === "P2028" ||
    err?.code === "P2034" ||
    err?.code === "40001" ||
    err?.code === "40P01" ||
    err?.meta?.code === "40001" ||
    err?.meta?.code === "40P01" ||
    Boolean(err?.message?.includes?.("deadlock")) ||
    Boolean(err?.message?.includes?.("serialization"))
  );
}

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
  venueId?: string,
): Promise<boolean> {
  const entry = await prisma.venueSeatWaitlist.findFirst({
    where: { id: waitlistId, userId },
  });

  if (!entry) return false;
  if (venueId && entry.venueId !== venueId) return false;

  await prisma.venueSeatWaitlist.update({
    where: { id: waitlistId },
    data: { status: "CANCELLED" },
  });

  return true;
}

/**
 * Checks and notifies the next eligible user in the waitlist when a seat becomes free.
 *
 * Eligibility is decided on real instants, not on the raw `date`/`time`
 * strings: a waiter is only offered the seat when the interval they asked for
 * (in their own timezone) overlaps the interval that was freed (in the freed
 * booking's timezone) and, when the freed seat is known, that seat has no other
 * active booking inside the waiter's interval.
 */
export async function notifyNextInWaitlist(
  venueId: string,
  date: string,
  time: string,
  freedDuration: number = 60,
  freedSeatId?: string | null,
  freedTimeZone?: string | null,
): Promise<{ notified: boolean; waitlistId?: string; userId?: string }> {
  // First expire any stale notified entries whose claim window lapsed
  await expireStaleWaitlistOffers();

  const freedInterval = bookingInterval(
    { date, time, timeZone: freedTimeZone, duration: freedDuration },
    "UTC",
  );
  if (!freedInterval) {
    return { notified: false };
  }

  // A waiter's wall-clock date can differ from the freed booking's date when
  // the two were made in different timezones or run past midnight, so fetch a
  // window of neighbouring dates and compare real instants below.
  const dates = conflictDateWindow(date);

  for (let attempt = 0; ; attempt++) {
    try {
      const selected = await prisma.$transaction(
        async (tx) => {
          // Row-level lock candidate waitlist rows (FOR UPDATE) in a serializable transaction
          // so simultaneous seat releases do not pick the same entry.
          await tx.$queryRaw`
            SELECT id FROM "VenueSeatWaitlist"
            WHERE "venueId" = ${venueId}
              AND "date" IN (${Prisma.join(dates)})
              AND "status" = 'ACTIVE'
            ORDER BY "createdAt" ASC
            FOR UPDATE
          `;

          // Find eligible candidates within the venue and time slot in FIFO order
          const candidates = await tx.venueSeatWaitlist.findMany({
            where: {
              venueId,
              date: { in: dates },
              status: "ACTIVE",
            },
            include: {
              venue: { select: { name: true } },
              user: { select: { email: true, firstName: true } },
            },
            orderBy: { createdAt: "asc" },
          });

          // Only waiters whose requested interval actually overlaps the freed
          // interval are eligible (FIFO order is preserved by the query).
          const overlapping = candidates.filter((c) => {
            const wanted = bookingInterval(
              {
                date: c.date,
                time: c.time,
                timeZone: c.timeZone,
                duration: c.duration,
              },
              "UTC",
            );
            return wanted !== null && intervalsOverlap(wanted, freedInterval);
          });

          if (overlapping.length === 0) {
            return null;
          }

          // Filter candidates matching seat preferences if freedSeatId is provided
          let candidate: typeof overlapping[0] | undefined = overlapping[0];
          if (freedSeatId) {
            const seat = await tx.venueSeat.findUnique({
              where: { id: freedSeatId },
            });
            if (!seat) {
              return null;
            }

            // The seat is only really free for a waiter if nobody else holds
            // it during the waiter's own interval.
            const seatBookings = await tx.booking.findMany({
              where: {
                seatId: freedSeatId,
                date: { in: dates },
                status: { in: ["CONFIRMED", "PENDING"] },
              },
              select: { date: true, time: true, duration: true, timeZone: true },
            });

            candidate = overlapping.find((c) => {
              if (c.seatId && c.seatId !== freedSeatId) return false;
              if (c.seatType && c.seatType !== seat.type) return false;
              if (c.requiresQuiet && !seat.isQuietZone) return false;
              if (c.requiresOutlets && !seat.amenities.includes("outlets")) return false;
              const taken = findConflictingBookings(
                {
                  date: c.date,
                  time: c.time,
                  timeZone: c.timeZone || "UTC",
                  duration: c.duration,
                },
                seatBookings,
              );
              return taken.length === 0;
            });
            if (!candidate) {
              return null;
            }
          }

          const claimExpiresAt = new Date(Date.now() + CLAIM_WINDOW_MINUTES * 60 * 1000);

          // Transition candidate to NOTIFIED status with expiration window
          const transitioned = await tx.venueSeatWaitlist.updateMany({
            where: { id: candidate.id, status: "ACTIVE" },
            data: {
              status: "NOTIFIED",
              notifiedAt: new Date(),
              claimExpiresAt,
              seatId: freedSeatId || candidate.seatId,
            },
          });

          if (transitioned.count !== 1) {
            return null;
          }

          return {
            candidate,
            claimExpiresAt,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!selected) {
        return { notified: false };
      }

      const { candidate, claimExpiresAt } = selected;

      // Dispatch WebPush / Push Notification outside transaction
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
    } catch (err: any) {
      if (isTransientTransactionError(err) && attempt < CLAIM_MAX_RETRIES) {
        const backoff = Math.min(2 ** (attempt + 1) * 100 + Math.random() * 50, 2000);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Claims an offered seat from the waitlist, converting it into a confirmed Booking.
 *
 * The whole claim runs in a single Serializable transaction that follows the
 * same locking/conflict protocol as POST /api/reservations/book:
 *
 *  1. The waitlist row is locked and re-read, and the NOTIFIED -> CLAIMED
 *     transition is a compare-and-set, so a double click / two devices can only
 *     ever produce one booking.
 *  2. Candidate seats are row-locked (FOR UPDATE) and checked against every
 *     CONFIRMED/PENDING booking in the conflict window, so a seat that was
 *     booked while the offer was pending (or already taken by an earlier
 *     claimer) is never handed out a second time.
 *  3. Booking creation and the waitlist status change commit atomically.
 */
export async function claimWaitlistSeat(
  waitlistId: string,
  userId: string,
): Promise<ClaimWaitlistSeatResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Serialise concurrent claims of the same entry.
          await tx.$queryRaw`SELECT id FROM "VenueSeatWaitlist" WHERE id = ${waitlistId} AND "userId" = ${userId} FOR UPDATE`;

          const entry = await tx.venueSeatWaitlist.findFirst({
            where: { id: waitlistId, userId },
            include: { user: true },
          });

          if (!entry) {
            throw new WaitlistClaimError("NOT_FOUND", "Waitlist entry not found.");
          }

          if (entry.status !== "NOTIFIED") {
            throw new WaitlistClaimError(
              "NOT_CLAIMABLE",
              `Entry is in ${entry.status} status and cannot be claimed.`,
            );
          }

          if (entry.claimExpiresAt && entry.claimExpiresAt < new Date()) {
            throw new WaitlistClaimError("EXPIRED", "Your claim window has expired.");
          }

          const timeZone = entry.timeZone || "UTC";

          // Seats that satisfy this entry's preferences. A specific seat on the
          // entry always wins; otherwise honour every stated preference.
          const candidateWhere: Prisma.VenueSeatWhereInput = entry.seatId
            ? { id: entry.seatId, venueId: entry.venueId, isEnabled: true }
            : {
                venueId: entry.venueId,
                isEnabled: true,
                ...(entry.seatType ? { type: entry.seatType } : {}),
                ...(entry.requiresQuiet ? { isQuietZone: true } : {}),
                ...(entry.requiresOutlets ? { amenities: { has: "outlets" } } : {}),
              };

          const candidateIds = (
            await tx.venueSeat.findMany({
              where: candidateWhere,
              select: { id: true },
              orderBy: { id: "asc" }, // stable lock order avoids deadlocks
            })
          ).map((seat) => seat.id);

          let targetSeat: { id: string; seatNumber: string } | null = null;

          if (candidateIds.length > 0) {
            // Row-lock the candidates for the rest of the transaction.
            await tx.$queryRaw`SELECT id FROM "VenueSeat" WHERE id IN (${Prisma.join(candidateIds)}) ORDER BY id FOR UPDATE`;

            const seats = await tx.venueSeat.findMany({
              where: { id: { in: candidateIds } },
              orderBy: { seatNumber: "asc" },
            });

            const existing = await tx.booking.findMany({
              where: {
                seatId: { in: candidateIds },
                // A conflicting booking can be stored under a neighbouring date
                // (it runs past midnight, or was made in another timezone).
                date: { in: conflictDateWindow(entry.date) },
                status: { in: ["CONFIRMED", "PENDING"] },
              },
              select: {
                seatId: true,
                date: true,
                time: true,
                duration: true,
                timeZone: true,
              },
            });

            const takenSeatIds = new Set(
              findConflictingBookings(
                {
                  date: entry.date,
                  time: entry.time,
                  timeZone,
                  duration: entry.duration,
                },
                existing,
              )
                .map((booking) => booking.seatId)
                .filter((seatId): seatId is string => Boolean(seatId)),
            );

            targetSeat = seats.find((seat) => !takenSeatIds.has(seat.id)) ?? null;
          } else if (!entry.seatId) {
            // Legacy venues without a seat map can still be booked seatless.
            // If the venue *has* seats but none match, that is a real conflict.
            const enabledSeats = await tx.venueSeat.count({
              where: { venueId: entry.venueId, isEnabled: true },
            });
            if (enabledSeats > 0) {
              throw new WaitlistClaimError(
                "SEAT_UNAVAILABLE",
                "No seat matching your preferences is available any more.",
              );
            }
          }

          const needsSeat = candidateIds.length > 0 || Boolean(entry.seatId);
          if (needsSeat && !targetSeat) {
            throw new WaitlistClaimError(
              "SEAT_UNAVAILABLE",
              "That seat was just reserved by someone else.",
            );
          }

          // Compare-and-set: only one concurrent claim can win this transition.
          const marked = await tx.venueSeatWaitlist.updateMany({
            where: { id: waitlistId, status: "NOTIFIED" },
            data: { status: "CLAIMED", claimedAt: new Date() },
          });
          if (marked.count !== 1) {
            throw new WaitlistClaimError(
              "NOT_CLAIMABLE",
              "This waitlist offer has already been claimed.",
            );
          }

          const booking = await tx.booking.create({
            data: {
              userId,
              venueId: entry.venueId,
              date: entry.date,
              time: entry.time,
              duration: entry.duration,
              timeZone,
              customerEmail: entry.user.email || "waitlist@worksphere.app",
              status: "CONFIRMED",
              confirmationId: `WS-${randomBytes(4).toString("hex").toUpperCase()}`,
              seatId: targetSeat?.id ?? null,
              seatNumber: targetSeat?.seatNumber ?? null,
            },
          });

          return {
            success: true,
            waitlistId,
            bookingId: booking.id,
            confirmationId: booking.confirmationId,
            seatId: targetSeat?.id,
            seatNumber: targetSeat?.seatNumber,
          } as ClaimWaitlistSeatResult;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err: any) {
      if (err instanceof WaitlistClaimError) {
        if (err.code === "EXPIRED") {
          await expireEntryAndOfferToNext(waitlistId);
        }
        return { success: false, waitlistId, error: err.message };
      }

      if (isTransientTransactionError(err) && attempt < CLAIM_MAX_RETRIES) {
        const backoff = Math.min(2 ** (attempt + 1) * 100 + Math.random() * 50, 2000);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      throw err;
    }
  }
}

/**
 * Marks a lapsed NOTIFIED entry as EXPIRED (compare-and-set, so it only
 * happens once) and offers the same seat to the next person in line.
 */
async function expireEntryAndOfferToNext(waitlistId: string): Promise<void> {
  const entry = await prisma.venueSeatWaitlist.findUnique({
    where: { id: waitlistId },
  });
  if (!entry) return;

  const { count } = await prisma.venueSeatWaitlist.updateMany({
    where: { id: waitlistId, status: "NOTIFIED" },
    data: { status: "EXPIRED" },
  });
  if (count !== 1) return;

  try {
    // Pass the seat that was offered so seat preferences are honoured and the
    // next waiter is offered the same seat (matches expireStaleWaitlistOffers).
    await notifyNextInWaitlist(
      entry.venueId,
      entry.date,
      entry.time,
      entry.duration,
      entry.seatId,
      entry.timeZone,
    );
  } catch (err) {
    console.error("Failed to offer expired waitlist seat to next in line:", err);
  }
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

  let expiredCount = 0;

  for (const entry of expiredEntries) {
    // Compare-and-set: concurrent sweeps (cron, notifyNextInWaitlist, claim)
    // may all see the same stale row, but only one may expire it and hand the
    // seat to the next person. Otherwise two waiters get offered the same seat.
    const { count } = await prisma.venueSeatWaitlist.updateMany({
      where: { id: entry.id, status: "NOTIFIED" },
      data: { status: "EXPIRED" },
    });
    if (count !== 1) continue;
    expiredCount++;

    // Awaited (and guarded) so the hand-off is not dropped when a serverless
    // runtime freezes after the response, and a failure cannot become an
    // unhandled promise rejection.
    try {
      await notifyNextInWaitlist(
        entry.venueId,
        entry.date,
        entry.time,
        entry.duration,
        entry.seatId,
        entry.timeZone,
      );
    } catch (err) {
      console.error("Failed to offer expired waitlist seat to next in line:", err);
    }
  }

  return expiredCount;
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
