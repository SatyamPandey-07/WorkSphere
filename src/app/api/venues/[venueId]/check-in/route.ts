import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { recordCheckIn, CHECK_IN_TTL_MS } from "@/lib/checkIn";
import { applyPrivacyFilter } from "@/lib/privacy/differentialPrivacy";
import { apiError } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ venueId: string }> };

/** POST /api/venues/:venueId/check-in — "I'm working here now". */
export async function POST(_req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  if (!(await rateLimit(`check-in:${userId}`, 10))) {
    return apiError(
      "Too many check-ins. Please wait a minute.",
      429,
      "RATE_LIMITED",
    );
  }

  const { venueId } = await context.params;
  const venue = await prisma.venue.findFirst({
    where: { OR: [{ id: venueId }, { placeId: venueId }] },
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  if (!venue) {
    return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
  }

  try {
    await ensureUserExists(userId);
    const result = await recordCheckIn(userId, venue);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[check-in] failed:", error);
    return apiError(
      "Check-in failed. Please try again.",
      500,
      "INTERNAL_ERROR",
    );
  }
}

/** DELETE /api/venues/:venueId/check-in — "I've left". */
export async function DELETE(_req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { venueId } = await context.params;
  const venue = await prisma.venue.findFirst({
    where: { OR: [{ id: venueId }, { placeId: venueId }] },
    select: { id: true },
  });
  if (venue) {
    await prisma.checkIn.deleteMany({ where: { userId, venueId: venue.id } });
  }
  return NextResponse.json({ success: true });
}

/** GET /api/venues/:venueId/check-in — live headcount and whether the caller is checked in. */
export async function GET(_req: Request, context: RouteContext) {
  const { userId } = await auth();
  const { venueId } = await context.params;
  const venue = await prisma.venue.findFirst({
    where: { OR: [{ id: venueId }, { placeId: venueId }] },
    select: { id: true },
  });
  if (!venue) {
    return NextResponse.json({ activeCount: 0, checkedIn: false });
  }

  const now = new Date();
  const [activeCount, mine] = await Promise.all([
    prisma.checkIn.count({
      where: { venueId: venue.id, expiresAt: { gt: now } },
    }),
    userId
      ? prisma.checkIn.findFirst({
          where: { venueId: venue.id, userId, expiresAt: { gt: now } },
          select: { expiresAt: true },
        })
      : null,
  ]);

  // Apply differential privacy filter to public venue occupancy queries 
  // when active visitors are below threshold N < 10
  const maxCapacity = 1000; // arbitrary max capacity for clamping
  const noisyActiveCount = applyPrivacyFilter(activeCount, maxCapacity, 1.0, 10);

  return NextResponse.json({
    activeCount: noisyActiveCount,
    checkedIn: Boolean(mine),
    expiresAt: mine?.expiresAt ?? null,
    ttlMinutes: CHECK_IN_TTL_MS / 60_000,
  });
}
