import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { eventBus } from "@/core/events";

export interface PromotionResult {
  promotedCount: number;
  promotedRsvps: Array<{
    id: string;
    userId: string;
    sessionId: string;
    status: string;
  }>;
}

/**
 * Automatically promotes waitlisted/MAYBE attendees to GOING for a social session
 * when available capacity allows (e.g., following an RSVP cancellation or capacity increase).
 *
 * Uses a serializable interactive transaction and atomic status compare-and-swap
 * to guard against race conditions and prevent duplicate promotions when session
 * capacity is updated rapidly or multiple RSVPs are cancelled concurrently (#5036).
 *
 * @param sessionId The ID of the CoworkingSession
 * @returns Details on any promoted RSVPs
 */
export async function autoPromoteSessionWaitlist(
  sessionId: string,
): Promise<PromotionResult> {
  const isolationLevel =
    Prisma?.TransactionIsolationLevel?.Serializable ?? "Serializable";

  const result = await prisma.$transaction(
    async (tx) => {
      const session = await tx.coworkingSession.findUnique({
        where: { id: sessionId },
        include: {
          _count: {
            select: {
              rsvps: {
                where: { status: "GOING" },
              },
            },
          },
        },
      });

      if (!session) {
        return { promotedCount: 0, promotedRsvps: [] };
      }

      // If no guest cap is set, no promotion queue constraint is active
      if (!session.maxGuests) {
        return { promotedCount: 0, promotedRsvps: [] };
      }

      const currentGoing = session._count.rsvps;
      const availableSlots = session.maxGuests - currentGoing;

      if (availableSlots <= 0) {
        return { promotedCount: 0, promotedRsvps: [] };
      }

      // Find the earliest MAYBE attendees waiting in FIFO order
      const waitlistedAttendees = await tx.sessionRsvp.findMany({
        where: {
          sessionId,
          status: "MAYBE",
        },
        orderBy: { createdAt: "asc" },
        take: availableSlots,
      });

      if (waitlistedAttendees.length === 0) {
        return { promotedCount: 0, promotedRsvps: [] };
      }

      const promotedRsvps: PromotionResult["promotedRsvps"] = [];

      for (const attendee of waitlistedAttendees) {
        // Atomic compare-and-swap: only transition if status is still MAYBE
        const updateResult = await tx.sessionRsvp.updateMany({
          where: {
            id: attendee.id,
            status: "MAYBE",
            sessionId,
          },
          data: { status: "GOING" },
        });

        if (updateResult.count > 0) {
          promotedRsvps.push({
            id: attendee.id,
            userId: attendee.userId,
            sessionId: attendee.sessionId,
            status: "GOING",
          });
        }
      }

      return {
        promotedCount: promotedRsvps.length,
        promotedRsvps,
      };
    },
    {
      isolationLevel: isolationLevel as any,
      timeout: 10000,
    },
  );

  // Emit eventBus events outside transaction for all successfully promoted RSVPs
  for (const promoted of result.promotedRsvps) {
    try {
      await eventBus.emit("session:rsvp", {
        sessionId: promoted.sessionId,
        rsvpId: promoted.id,
        userId: promoted.userId,
        status: "GOING",
      });

      await eventBus.emit("session:promoted", {
        sessionId: promoted.sessionId,
        rsvpId: promoted.id,
        userId: promoted.userId,
        previousStatus: "MAYBE",
      });
    } catch (error) {
      console.error(
        `[autoPromoteSessionWaitlist] Error emitting events for RSVP ${promoted.id}:`,
        error,
      );
    }
  }

  return result;
}
