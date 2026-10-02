import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { recordCheckIn, CHECK_IN_TTL_MS } from "@/lib/checkIn";

type RouteContext = { params: Promise<{ venueId: string }> };

/** POST /api/venues/:venueId/check-in — "I'm working here now". */
export async function POST(_req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await rateLimit(`check-in:${userId}`, 10))) {
    return NextResponse.json(
      { error: "Too many check-ins. Please wait a minute." },
      { status: 429 },
    );
  }

  const { venueId } = await context.params;
  const venue = await prisma.venue.findFirst({
    where: { OR: [{ id: venueId }, { placeId: venueId }] },
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  if (!venue) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  try {
    await ensureUserExists(userId);
    const result = await recordCheckIn(userId, venue);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[check-in] failed:", error);
    return NextResponse.json(
      { error: "Check-in failed. Please try again." },
      { status: 500 },
    );
  }
}

/** DELETE /api/venues/:venueId/check-in — "I've left". */
export async function DELETE(_req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  return NextResponse.json({
    activeCount,
    checkedIn: Boolean(mine),
    expiresAt: mine?.expiresAt ?? null,
    ttlMinutes: CHECK_IN_TTL_MS / 60_000,
  });
}
