import { prisma } from "./prisma";
import { calculateStreak, getUnlockedMilestones } from "./streak";
import { emitWebhookEvent } from "./webhooks/deliver";

/** A check-in counts toward live occupancy for this long unless renewed. */
export const CHECK_IN_TTL_MS = 4 * 60 * 60 * 1000;

export interface CheckInResult {
  checkIn: { venueId: string; createdAt: Date; expiresAt: Date };
  streak: {
    currentStreak: number;
    longestStreak: number;
    incremented: boolean;
    newMilestones: number[];
    unlockedMilestones: number[];
  };
}

/**
 * Records that `userId` is working at `venueId` right now: refreshes the live
 * check-in (used for occupancy), advances the daily activity streak and
 * notifies the user's webhook subscribers.
 */
export async function recordCheckIn(
  userId: string,
  venue: { id: string; name: string; latitude: number; longitude: number },
  now: Date = new Date(),
): Promise<CheckInResult> {
  const expiresAt = new Date(now.getTime() + CHECK_IN_TTL_MS);

  const { checkIn, streak } = await prisma.$transaction(async (tx) => {
    const checkIn = await tx.checkIn.upsert({
      where: { userId_venueId: { userId, venueId: venue.id } },
      update: { createdAt: now, expiresAt },
      create: { userId, venueId: venue.id, createdAt: now, expiresAt },
    });

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        currentStreak: true,
        longestStreak: true,
        lastCheckInDate: true,
        timezone: true,
      },
    });
    const streak = calculateStreak(
      user.lastCheckInDate,
      user.currentStreak,
      user.longestStreak,
      user.timezone || "UTC",
    );
    if (streak.incremented) {
      await tx.user.update({
        where: { id: userId },
        data: {
          currentStreak: streak.currentStreak,
          longestStreak: streak.longestStreak,
          lastCheckInDate: streak.lastCheckInDate,
        },
      });
    }
    return { checkIn, streak };
  });

  emitWebhookEvent(userId, "MAP_GEOFENCE_BREACHED", {
    event: "check_in",
    venueId: venue.id,
    venueName: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    checkedInAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  return {
    checkIn: {
      venueId: checkIn.venueId,
      createdAt: checkIn.createdAt,
      expiresAt: checkIn.expiresAt,
    },
    streak: {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      incremented: streak.incremented,
      newMilestones: streak.newMilestones,
      unlockedMilestones: getUnlockedMilestones(streak.currentStreak),
    },
  };
}
