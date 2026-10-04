import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  acquireSeatWebLock,
  releaseSeatWebLock,
  getSeatWebLock,
  DEFAULT_LOCK_TTL_SECONDS,
} from "@/lib/locks/seatHoldLock";
import { apiError } from "@/lib/apiResponse";

type RouteContext = {
  params: Promise<{ venueId: string; seatId: string }>;
};

/**
 * POST /api/venues/:venueId/seats/:seatId/lock
 * Acquires a 5-minute exclusive hold lock on a seat for the authenticated user.
 */
export async function POST(req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { venueId, seatId } = await context.params;
  const user = await currentUser();
  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    "User";

  let ttlSeconds = DEFAULT_LOCK_TTL_SECONDS;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.ttlSeconds === "number") {
      ttlSeconds = body.ttlSeconds;
    }
  } catch {
    // Ignore body parse error, use default TTL
  }

  const result = await acquireSeatWebLock(
    venueId,
    seatId,
    userId,
    userName,
    ttlSeconds,
  );

  if (!result.success) {
    return apiError("SEAT_ALREADY_HELD", 409, "CONFLICT", {
      heldBy: result.heldBy,
      heldByName: result.heldByName,
      expiresAt: result.expiresAt,
      remainingSeconds: result.remainingSeconds,
    });
  }

  return NextResponse.json({
    success: true,
    lock: result.lock,
  });
}

/**
 * DELETE /api/venues/:venueId/seats/:seatId/lock
 * Releases the seat lock if held by the authenticated user.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { venueId, seatId } = await context.params;
  const released = await releaseSeatWebLock(venueId, seatId, userId);

  return NextResponse.json({
    success: released,
    seatId,
    venueId,
  });
}

/**
 * GET /api/venues/:venueId/seats/:seatId/lock
 * Inspects whether a seat is currently locked.
 */
export async function GET(_req: Request, context: RouteContext) {
  const { venueId, seatId } = await context.params;
  const lock = await getSeatWebLock(venueId, seatId);

  return NextResponse.json({
    isLocked: !!lock,
    lock: lock || null,
  });
}
